import type { Sandbox, Process } from '@cloudflare/sandbox';
import type { OpenClawEnv } from '../types';
import { OPENCLAW_PORT, STARTUP_TIMEOUT_MS } from '../config';
import { buildEnvVars } from './env';
import { ensureRcloneConfig } from './r2';
import { syncToR2 } from './sync';
import { waitForProcess } from './utils';

// ---------------------------------------------------------------------------
// Restart rate-limiting (module-level, per Worker isolate)
// ---------------------------------------------------------------------------
const RESTART_COOLDOWN_MS = 30_000; // 30 s between restart attempts
const lastRestartAttempt: Map<string, number> = new Map();

function isRestartCoolingDown(key: string): boolean {
  const last = lastRestartAttempt.get(key);
  return last !== undefined && Date.now() - last < RESTART_COOLDOWN_MS;
}

function recordRestartAttempt(key: string): void {
  lastRestartAttempt.set(key, Date.now());
}

// ---------------------------------------------------------------------------
// Auto-approve device pairing
// ---------------------------------------------------------------------------

/**
 * Attempt to auto-approve any pending device pairing requests.
 * Runs in the background after gateway startup when AUTO_APPROVE_DEVICES=true.
 */
export async function autoApproveDevices(sandbox: Sandbox, env: OpenClawEnv): Promise<void> {
  const tokenArg = env.OPENCLAW_GATEWAY_TOKEN ? ` --token ${env.OPENCLAW_GATEWAY_TOKEN}` : '';

  // List pending devices
  let pending: Array<{ requestId: string }> = [];
  try {
    const listProc = await sandbox.startProcess(
      `openclaw devices list --json --url ws://localhost:${OPENCLAW_PORT}${tokenArg}`,
    );
    await waitForProcess(listProc, 20_000);
    const logs = await listProc.getLogs();
    const jsonMatch = (logs.stdout ?? '').match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]) as { pending?: Array<{ requestId: string }> };
      pending = data.pending ?? [];
    }
  } catch {
    return; // Non-fatal — don't throw
  }

  for (const device of pending) {
    try {
      const approveProc = await sandbox.startProcess(
        `openclaw devices approve ${device.requestId} --url ws://localhost:${OPENCLAW_PORT}${tokenArg}`,
      );
      // eslint-disable-next-line no-await-in-loop
      await waitForProcess(approveProc, 20_000);
      // eslint-disable-next-line no-await-in-loop
      const approveLogs = await approveProc.getLogs();
      const didApprove =
        (approveLogs.stdout?.toLowerCase().includes('approved') ?? false) ||
        approveProc.exitCode === 0;
      if (didApprove) {
        console.log('[auto-approve] Approved device:', device.requestId);
        // Flush approved device state to R2 immediately
        try {
          // eslint-disable-next-line no-await-in-loop
          const syncResult = await syncToR2(sandbox, env);
          if (!syncResult.success) {
            console.warn('[auto-approve] R2 sync returned failure after device approval:', syncResult.error ?? '(no details)');
          }
        } catch (syncErr) {
          console.warn('[auto-approve] R2 sync threw after device approval (non-fatal):', syncErr);
        }
      } else {
        console.warn('[auto-approve] Approval may have failed for device:', device.requestId, approveLogs.stderr);
      }
    } catch (err) {
      console.warn('[auto-approve] Failed to approve device:', device.requestId, err);
    }
  }
}

/**
 * Find an existing OpenClaw gateway process
 *
 * @param sandbox - The sandbox instance
 * @returns The process if found and running/starting, null otherwise
 */
export async function findExistingOpenClawProcess(sandbox: Sandbox): Promise<Process | null> {
  try {
    const processes = await sandbox.listProcesses();
    for (const proc of processes) {
      // Match gateway process (openclaw gateway or legacy clawdbot gateway)
      // Don't match CLI commands like "openclaw devices list"
      const isGatewayProcess =
        proc.command.includes('start-openclaw.sh') ||
        proc.command.includes('openclaw gateway') ||
        proc.command.includes('clawdbot gateway');
      const isCliCommand =
        proc.command.includes('openclaw devices') ||
        proc.command.includes('openclaw --version') ||
        proc.command.includes('openclaw onboard') ||
        proc.command.includes('clawdbot devices') ||
        proc.command.includes('clawdbot --version');

      if (isGatewayProcess && !isCliCommand) {
        if (proc.status === 'starting' || proc.status === 'running') {
          return proc;
        }
      }
    }
  } catch (e) {
    console.log('Could not list processes:', e);
  }
  return null;
}

/**
 * Ensure the OpenClaw gateway is running
 *
 * This will:
 * 1. Mount R2 storage if configured
 * 2. Check for an existing gateway process
 * 3. Wait for it to be ready, or start a new one
 *
 * @param sandbox - The sandbox instance
 * @param env - Worker environment bindings
 * @returns The running gateway process
 */
export async function ensureOpenClawGateway(sandbox: Sandbox, env: OpenClawEnv): Promise<Process> {
  // Configure rclone for R2 persistence (non-blocking if not configured).
  // The startup script uses rclone to restore data from R2 on boot.
  await ensureRcloneConfig(sandbox, env);

  // Check if gateway is already running or starting
  const existingProcess = await findExistingOpenClawProcess(sandbox);
  if (existingProcess) {
    console.log(
      'Found existing gateway process:',
      existingProcess.id,
      'status:',
      existingProcess.status,
    );

    // Use a short initial probe to detect processes that crashed early.
    // If the process is genuinely still starting, fall back to the full timeout.
    const QUICK_PROBE_MS = 10_000;
    try {
      console.log('Quick-probing gateway on port', OPENCLAW_PORT, 'timeout:', QUICK_PROBE_MS);
      await existingProcess.waitForPort(OPENCLAW_PORT, { mode: 'tcp', timeout: QUICK_PROBE_MS });
      console.log('Gateway is reachable');
      return existingProcess;
      // eslint-disable-next-line no-unused-vars
    } catch (_e) {
      // Timeout waiting for port - process is likely dead or stuck.
      // Apply restart cooldown to prevent concurrent requests from all trying to restart.
      const cooldownKey = 'gateway-restart';
      if (isRestartCoolingDown(cooldownKey)) {
        console.log('Restart cooldown active — skipping kill/restart, will retry on next request');
        throw new Error('Gateway is unresponsive and restart cooldown is active. Please try again shortly.');
      }
      recordRestartAttempt(cooldownKey);
      console.log('Existing process not reachable after full timeout, killing and restarting...');
      try {
        await existingProcess.kill();
      } catch (killError) {
        console.log('Failed to kill process:', killError);
      }
    }
  }

  // Start a new OpenClaw gateway
  console.log('Starting new OpenClaw gateway...');
  const envVars = buildEnvVars(env);
  const command = '/usr/local/bin/start-openclaw.sh';

  console.log('Starting process with command:', command);
  console.log('Environment vars being passed:', Object.keys(envVars));

  let process: Process;
  try {
    process = await sandbox.startProcess(command, {
      env: Object.keys(envVars).length > 0 ? envVars : undefined,
    });
    console.log('Process started with id:', process.id, 'status:', process.status);
  } catch (startErr) {
    console.error('Failed to start process:', startErr);
    throw startErr;
  }

  // Wait for the gateway to be ready
  try {
    console.log('[Gateway] Waiting for OpenClaw gateway to be ready on port', OPENCLAW_PORT);
    await process.waitForPort(OPENCLAW_PORT, { mode: 'tcp', timeout: STARTUP_TIMEOUT_MS });
    console.log('[Gateway] OpenClaw gateway is ready!');

    const logs = await process.getLogs();
    if (logs.stdout) console.log('[Gateway] stdout:', logs.stdout);
    if (logs.stderr) console.log('[Gateway] stderr:', logs.stderr);
  } catch (e) {
    console.error('[Gateway] waitForPort failed:', e);
    try {
      const logs = await process.getLogs();
      console.error('[Gateway] startup failed. Stderr:', logs.stderr);
      console.error('[Gateway] startup failed. Stdout:', logs.stdout);
      throw new Error(`OpenClaw gateway failed to start. Stderr: ${logs.stderr || '(empty)'}`, {
        cause: e,
      });
    } catch (logErr) {
      console.error('[Gateway] Failed to get logs:', logErr);
      throw e;
    }
  }

  // Verify gateway is actually responding
  console.log('[Gateway] Verifying gateway health...');

  // Auto-approve any pending device pairing requests (non-blocking)
  if (env.AUTO_APPROVE_DEVICES === 'true') {
    autoApproveDevices(sandbox, env).catch((err) => {
      console.warn('[Gateway] Auto-approve devices failed (non-fatal):', err);
    });
  }

  return process;
}
