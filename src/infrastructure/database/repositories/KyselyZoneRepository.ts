import { sql, type Kysely } from 'kysely';
import type { Database, Db } from '../db.js';
import type { ZoneGeoJson, ZoneRecord, ZoneRepository } from '../../../usecases/ports/ZoneRepository.js';

interface ZoneRow {
  id: string;
  code: string;
  name: string;
  base_rate_motor: string;
  base_rate_car: string;
}

function toRecord(row: ZoneRow): ZoneRecord {
  const toBigInt = (v: string): bigint => BigInt(v.split('.')[0] ?? '0');
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    baseRateMotor: toBigInt(row.base_rate_motor),
    baseRateCar: toBigInt(row.base_rate_car),
  };
}

/** Spatial zone lookups implemented with PostGIS (TRD §10.1, raw parameterized SQL — no concat). */
export class KyselyZoneRepository implements ZoneRepository {
  private readonly db: Kysely<Database>;

  constructor(db: Db) {
    this.db = db;
  }

  async findZoneContaining(latitude: number, longitude: number): Promise<ZoneRecord | null> {
    const result = await sql<ZoneRow>`
      SELECT id, code, name, base_rate_motor, base_rate_car
      FROM parking_zones
      WHERE is_active = TRUE
        AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326))
      LIMIT 1`.execute(this.db);
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<ZoneRecord | null> {
    const row = await this.db
      .selectFrom('parking_zones')
      .select(['id', 'code', 'name', 'base_rate_motor', 'base_rate_car'])
      .where('id', '=', id)
      .where('is_active', '=', true)
      .executeTakeFirst();
    return row ? toRecord(row as ZoneRow) : null;
  }

  async listActiveGeoJson(): Promise<ZoneGeoJson[]> {
    const result = await sql<ZoneGeoJson>`
      SELECT id, code, name, ST_AsGeoJSON(boundary) AS geometry
      FROM parking_zones
      WHERE is_active = TRUE
      ORDER BY code`.execute(this.db);
    return result.rows;
  }
}
