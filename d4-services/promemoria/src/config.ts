export type Config = {
  calDatabaseUrl: string; calWebappUrl: string;
  smtpHost: string; smtpPort: number; smtpUser: string; smtpPassword: string;
  emailFrom: string; emailFromName: string; alarmEmail: string;
  adminPassword: string; sessionSecret: string;
  dataDir: string; port: number; tzDefault: string;
};

const REQUIRED = [
  "CAL_DATABASE_URL", "CAL_WEBAPP_URL", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD",
  "EMAIL_FROM", "ALARM_EMAIL", "ADMIN_PASSWORD", "SESSION_SECRET",
];

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Variabili mancanti: ${missing.join(", ")}`);
  return {
    calDatabaseUrl: env.CAL_DATABASE_URL!, calWebappUrl: env.CAL_WEBAPP_URL!.replace(/\/$/, ""),
    smtpHost: env.SMTP_HOST!, smtpPort: Number(env.SMTP_PORT ?? 587),
    smtpUser: env.SMTP_USER!, smtpPassword: env.SMTP_PASSWORD!,
    emailFrom: env.EMAIL_FROM!, emailFromName: env.EMAIL_FROM_NAME ?? "Dimensione 4",
    alarmEmail: env.ALARM_EMAIL!, adminPassword: env.ADMIN_PASSWORD!, sessionSecret: env.SESSION_SECRET!,
    dataDir: env.DATA_DIR ?? "/data", port: Number(env.PORT ?? 3000), tzDefault: env.TZ_DEFAULT ?? "Europe/Rome",
  };
}
