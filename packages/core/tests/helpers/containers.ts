// Testcontainers orchestration for E2E tests
// Intentionally scaffolded: wire up actual containers in follow-up

export type PostgresInfo = {
  url: string; // e.g., postgresql://user:pass@host:port/db?schema=public
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export type MinioInfo = {
  endpoint: string; // server ops endpoint (e.g., http://127.0.0.1:39000)
  presignEndpoint: string; // client URLs (e.g., http://127.0.0.1:39000)
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  forcePathStyle?: boolean;
};

export type MailhogInfo = {
  smtpUrl: string; // e.g., smtp://127.0.0.1:31025
  httpUrl: string; // e.g., http://127.0.0.1:38025
};

export type E2EEnv = {
  postgres: PostgresInfo;
  minio: MinioInfo;
  mailhog: MailhogInfo;
};

let envRef: E2EEnv | null = null;
let started: {
  pg?: any;
  minio?: any;
  mailhog?: any;
} = {};

export function getEnv(): E2EEnv {
  if (!envRef) throw new Error("E2E environment not initialized. Did you call startAll()?");
  return envRef;
}

export async function startAll(): Promise<E2EEnv> {
  if (envRef) return envRef;
  const { GenericContainer, Wait } = await import("testcontainers");
  const { prismaMigrateDeploy } = await import("./db.js");

  // Postgres
  const pgUser = "latchflow";
  const pgPass = "latchflow";
  const pgDb = "latchflow";
  const pgContainer = await new GenericContainer("postgres:16-alpine")
    .withEnv("POSTGRES_USER", pgUser)
    .withEnv("POSTGRES_PASSWORD", pgPass)
    .withEnv("POSTGRES_DB", pgDb)
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections"))
    .start();
  const pgHost = pgContainer.getHost();
  const pgPort = pgContainer.getMappedPort(5432);

  // MinIO
  const minioUser = "minioadmin";
  const minioPass = "minioadmin";
  const minioBucket = "latchflow-e2e";
  const minioContainer = await new GenericContainer("minio/minio:latest")
    .withEnv("MINIO_ROOT_USER", minioUser)
    .withEnv("MINIO_ROOT_PASSWORD", minioPass)
    .withExposedPorts(9000, 9001)
    .withWaitStrategy(Wait.forLogMessage("API: http"))
    .withCommand(["server", "/data", "--console-address", ":9001"])
    .start();
  const minioHost = minioContainer.getHost();
  const minioPort = minioContainer.getMappedPort(9000);
  const minioEndpoint = `http://${minioHost}:${minioPort}`;

  // Create bucket using AWS SDK v3
  try {
    const { S3Client, CreateBucketCommand, HeadBucketCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
      region: "us-east-1",
      endpoint: minioEndpoint,
      credentials: { accessKeyId: minioUser, secretAccessKey: minioPass },
      forcePathStyle: true,
    });
    // Attempt head first; if not exists, create
    const head = new HeadBucketCommand({ Bucket: minioBucket });
    try {
      await s3.send(head);
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: minioBucket }));
    }
  } catch {
    // ignore bucket creation errors in scaffold
  }

  // MailHog
  const mailhogContainer = await new GenericContainer("mailhog/mailhog:latest")
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp("/api/v2/messages").forStatusCode(200).withPort(8025))
    .start();
  const mhHost = mailhogContainer.getHost();
  const mhHttpPort = mailhogContainer.getMappedPort(8025);
  const mhSmtpPort = mailhogContainer.getMappedPort(1025);

  const env: E2EEnv = {
    postgres: {
      url: `postgresql://${pgUser}:${pgPass}@${pgHost}:${pgPort}/${pgDb}?schema=public`,
      host: pgHost,
      port: pgPort,
      user: pgUser,
      password: pgPass,
      database: pgDb,
    },
    minio: {
      endpoint: minioEndpoint,
      presignEndpoint: minioEndpoint,
      accessKeyId: minioUser,
      secretAccessKey: minioPass,
      region: "us-east-1",
      bucket: minioBucket,
      forcePathStyle: true,
    },
    mailhog: {
      smtpUrl: `smtp://${mhHost}:${mhSmtpPort}`,
      httpUrl: `http://${mhHost}:${mhHttpPort}`,
    },
  };

  envRef = env;
  started = { pg: pgContainer, minio: minioContainer, mailhog: mailhogContainer };

  // Run Prisma migrate deploy against ephemeral Postgres
  try {
    await prismaMigrateDeploy(env.postgres.url);
  } catch (err) {
    // Surface a helpful error early if migrations fail
    // eslint-disable-next-line no-console
    console.error("Prisma migrate failed in E2E setup:", err);
    throw err;
  }

  return env;
}

export async function stopAll(): Promise<void> {
  try {
    await started.mailhog?.stop();
  } catch (_err) {
    // ignore teardown errors
  }
  try {
    await started.minio?.stop();
  } catch (_err) {
    // ignore teardown errors
  }
  try {
    await started.pg?.stop();
  } catch (_err) {
    // ignore teardown errors
  }
  started = {};
  envRef = null;
}
