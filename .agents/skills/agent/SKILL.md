```markdown
# agent Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you how to contribute to the `agent` TypeScript codebase, focusing on its coding conventions, commit patterns, and common development workflows. You'll learn how to structure files, write imports and exports, and follow the established process for updating authentication middleware and its tests.

## Coding Conventions

- **File Naming:**  
  Use camelCase for file names.  
  _Example:_  
  ```
  src/auth/middleware.ts
  src/user/userProfile.ts
  ```

- **Import Style:**  
  Use relative imports for modules within the codebase.  
  _Example:_  
  ```typescript
  import { authenticate } from './middleware';
  ```

- **Export Style:**  
  Use named exports rather than default exports.  
  _Example:_  
  ```typescript
  // In src/auth/middleware.ts
  export function authenticate(req, res, next) { ... }
  ```

- **Commit Messages:**  
  Follow the Conventional Commits standard, using prefixes like `fix`.  
  _Example:_  
  ```
  fix: correct token validation logic in middleware
  ```

## Workflows

### Auth Middleware Update and Test
**Trigger:** When you need to fix, update, or enhance authentication logic and verify it with tests.  
**Command:** `/update-auth-middleware`

1. **Modify authentication logic:**  
   Edit `src/auth/middleware.ts` to update or improve the authentication middleware as required.
   ```typescript
   // src/auth/middleware.ts
   export function authenticate(req, res, next) {
     // Updated authentication logic here
   }
   ```
2. **Update or add tests:**  
   Edit or create tests in `src/auth/middleware.test.ts` to ensure your changes are covered.
   ```typescript
   // src/auth/middleware.test.ts
   import { authenticate } from './middleware';

   test('should reject invalid tokens', () => {
     // Test logic here
   });
   ```
3. **Commit your changes:**  
   Use a conventional commit message, e.g.:
   ```
   fix: update authentication logic and add tests for edge cases
   ```
4. **Run tests:**  
   Ensure all tests pass before submitting your changes.

## Testing Patterns

- **Test File Naming:**  
  Test files follow the `*.test.*` pattern and are located alongside the code they test.
  _Example:_  
  ```
  src/auth/middleware.test.ts
  ```

- **Framework:**  
  The specific testing framework is not detected, but tests are written in TypeScript and follow standard patterns.

- **Test Example:**  
  ```typescript
  import { authenticate } from './middleware';

  test('should authenticate valid user', () => {
    // Arrange: set up request and response mocks
    // Act: call authenticate
    // Assert: check expected behavior
  });
  ```

## Commands

| Command                | Purpose                                                      |
|------------------------|--------------------------------------------------------------|
| /update-auth-middleware| Update authentication middleware and corresponding tests      |
```