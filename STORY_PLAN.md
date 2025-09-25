## **Summary**

Build database-backed system configuration management with admin APIs and encrypted secrets support, replacing environment-only configuration and providing the foundation for runtime system administration.

## **Scope**

- **Database Infrastructure**: Create SystemConfig table with support for structured configuration data, encrypted secrets, and audit trails.
- **Configuration Management**: Replace key environment variables with database-backed settings that can be modified at runtime without server restarts.
- **Admin APIs**: Build comprehensive CRUD endpoints for system configuration with proper authorization and validation.
- **Encryption Integration**: Integrate with existing AES-GCM encryption system for secure storage of sensitive configuration values.
- **Migration Strategy**: Provide smooth transition from environment variables to database storage with automatic env var seeding at startup, fallback mechanisms, and backward compatibility during transition periods.
- **Foundation for Extensions**: Establish patterns and APIs that plugins and future features can leverage for their own configuration needs.

## **To-Do**

### **Phase 1: Database Foundation**
- [x]  Create SystemConfig Prisma model with proper relationships, JSON support, and encrypted secrets fields.
- [x]  Add database migration and update User model for audit trail relationships.
- [x]  Integrate with existing AES-GCM encryption system for secrets storage and retrieval.

### **Phase 2: Configuration Service**
- [x]  Build SystemConfigService with CRUD operations, validation, and encryption/decryption handling.
- [x]  Implement environment variable fallback system: check database first, then fall back to env vars if not found.
- [x]  Add automatic env var seeding at startup: populate SystemConfig table with values from environment variables on first run.
- [x]  Implement configuration schema validation using JSON schemas for type safety and UI generation.
- [x]  Add configuration categories and metadata support for organized admin interfaces.

### **Phase 3: Admin APIs**
- [x]  Create bulk configuration endpoints: `GET /system/config` (with filtering), `PUT /system/config` (transactional bulk updates) with proper authorization.
- [x]  Add individual configuration endpoints as convenience wrappers: `GET/PUT/DELETE /system/config/:key`.
- [x]  Add configuration testing endpoints: `POST /system/config/test` for validating configurations before saving.
- [x]  Implement audit logging for all configuration changes with user attribution and bulk operation support.

### **Phase 4: Email Configuration Migration**
- [ ]  Create email configuration schema and migration logic for SMTP_URL, SMTP_FROM environment variables.
- [ ]  Implement graceful migration: if env vars exist but no database config, automatically seed database and continue using database values thereafter.
- [ ]  Add configuration precedence system: database values take priority over env vars, with clear admin visibility into which source is active.
- [ ]  Add email testing endpoint to validate SMTP configurations before saving.

### **Phase 5: Testing & Documentation**
- [x]  **Unit Tests**: SystemConfigService operations, encryption/decryption, validation logic.
- [ ]  **Integration Tests**: Admin APIs, database operations, migration scripts.
- [ ]  **Security Tests**: Ensure secrets are properly encrypted and never exposed in logs or API responses.
- [ ]  **Migration Tests**: Verify smooth transition from environment variables to database storage, test env var fallback behavior, and validate seeding logic.
- [ ]  **Precedence Tests**: Ensure database values correctly override env vars and precedence is clearly visible to admins.
- [ ]  Write comprehensive documentation: API reference, configuration management guide, security considerations.

## **DoD**

- [ ]  SystemConfig table exists with proper encryption support and audit trails.
- [ ]  Admin APIs allow runtime configuration management without server restarts.
- [ ]  Email settings successfully migrated from environment variables to database with automatic seeding, fallback behavior, and clear precedence system.
- [ ]  Configuration precedence works correctly: database values override env vars, with admin visibility into active configuration source.
- [ ]  All secrets are properly encrypted and never exposed in API responses or logs.
- [ ]  Comprehensive test suite covers all configuration operations, security, and migration scenarios; `pnpm -r test` passes locally.
- [ ]  Documentation provides clear guidance for system administrators and future development.
