# packages/db

This package contains the Prisma setup and generated client for database access.

## Environment Variables

The `.env` file in this directory includes a placeholder for your database connection:

```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/mydb?schema=public"
```

Replace `USER`, `PASSWORD`, `localhost`, `5432`, and `mydb` with your PostgreSQL credentials.

## Getting Started

From the `packages/db` directory, run:

```sh
# Install dependencies
pnpm install

# Generate the Prisma Client
npx prisma generate

# (Re)create a migration and apply it to your database
npx prisma migrate dev --name init

# (Optional) Introspect an existing database schema
npx prisma db pull
```
