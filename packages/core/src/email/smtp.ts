import type SMTPTransport from "nodemailer/lib/smtp-transport";

export function buildSmtpTransportOptions(smtpUrl: string): SMTPTransport.Options {
  const url = new URL(smtpUrl);
  const secure = url.protocol === "smtps:";
  const port = url.port ? Number(url.port) : secure ? 465 : 587;
  const ignoreTLS = url.searchParams.get("ignoreTLS") === "true";
  const rejectUnauthorizedParam = url.searchParams.get("rejectUnauthorized");
  const tlsOptions =
    rejectUnauthorizedParam !== null
      ? { rejectUnauthorized: rejectUnauthorizedParam !== "false" }
      : undefined;

  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;

  const auth = username || password ? { user: username ?? "", pass: password ?? "" } : undefined;

  return {
    host: url.hostname,
    port,
    secure,
    auth,
    ignoreTLS,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 5_000,
    ...(tlsOptions ? { tls: tlsOptions } : {}),
  } satisfies SMTPTransport.Options;
}
