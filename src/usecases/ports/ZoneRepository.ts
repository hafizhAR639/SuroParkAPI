/** Read model for an active parking zone (PostGIS lookup is an infra concern). */
export interface ZoneRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly baseRateMotor: bigint;
  readonly baseRateCar: bigint;
}

/** GeoJSON rendering of an active zone for the admin map endpoint (TRD §5.1). */
export interface ZoneGeoJson {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly geometry: string;
}

/** Spatial repository port (TRD §10.1). Implemented with PostGIS ST_Contains. */
export interface ZoneRepository {
  /** Returns the active zone whose polygon contains (lat,lng), else null. */
  findZoneContaining(latitude: number, longitude: number): Promise<ZoneRecord | null>;
  /** Fetch an active zone by id (for tariff lookup at checkout). */
  findById(id: string): Promise<ZoneRecord | null>;
  /** All active zones with their boundary as GeoJSON (admin map, RBAC ADMIN). */
  listActiveGeoJson(): Promise<ZoneGeoJson[]>;
}
