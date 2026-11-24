import nodemailer from "nodemailer";
import type { Config } from "./config.ts";
import type { Mail, Mailer } from "./loop.ts";

export function createMailer(cfg: Config): Mailer {
  const t = nodemailer.createTransport({
    host: cfg.smtpHost, port: cfg.smtpPort, secure: cfg.smtpPort === 465,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPassword },
  });
  return {
    async send(to: string, m: Mail) {
      try {
        await t.sendMail({ from: { name: cfg.emailFromName, address: cfg.emailFrom }, to, subject: m.subject, text: m.text, html: m.html });
      } catch (e: any) {
        // 4xx SMTP o errore di rete = temporaneo; 5xx = definitivo
        e.temporary = e.responseCode ? e.responseCode >= 400 && e.responseCode < 500 : true;
        throw e;
      }
    },
  };
}
