import pg from "pg";
import type { CalBooking } from "./plan.ts";

// Cal salva timestamp senza fuso, in UTC: senza questo pg li leggerebbe come ora locale
pg.types.setTypeParser(1114, (s: string) => new Date(s.replace(" ", "T") + "Z"));

const SELECT = `SELECT b.uid, b.status::text AS status, b."startTime", b."endTime", b."createdAt", b."eventTypeId", b.title,
  b."fromReschedule", b.responses, b.location, b.metadata,
  a.name AS a_name, a.email AS a_email, a."timeZone" AS a_tz, a."phoneNumber" AS a_phone
FROM "Booking" b
LEFT JOIN LATERAL (SELECT * FROM "Attendee" WHERE "bookingId" = b.id ORDER BY id LIMIT 1) a ON true`;

const toBooking = (r: any): CalBooking => ({
  uid: r.uid, status: r.status, startTime: r.startTime.toISOString(), endTime: r.endTime.toISOString(),
  createdAt: r.createdAt.toISOString(), eventTypeId: r.eventTypeId, title: r.title, fromReschedule: r.fromReschedule,
  responses: r.responses, location: r.location, metadata: r.metadata,
  attendee: r.a_email ? { name: r.a_name, email: r.a_email, timeZone: r.a_tz, phoneNumber: r.a_phone } : null,
});

export function createCal(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 });
  pool.on("error", () => {}); // gli errori arrivano comunque alle query; evita il crash del processo
  const DAY = 86_400_000;
  return {
    async listWindow(now: Date) {
      const r = await pool.query(`${SELECT} WHERE b."startTime" BETWEEN $1 AND $2`,
        [new Date(now.getTime() - DAY), new Date(now.getTime() + 56 * DAY)]);
      return r.rows.map(toBooking);
    },
    async get(uid: string) {
      const r = await pool.query(`${SELECT} WHERE b.uid = $1`, [uid]);
      return r.rows[0] ? toBooking(r.rows[0]) : undefined;
    },
    close: () => pool.end(),
  };
}
