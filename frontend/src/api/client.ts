const BASE = "http://localhost:8000";

export async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface DistrictProperties {
  district_id: string;
  name: string;
  kabupaten: string;
  provinsi: string;
}

export type DistrictCollection = GeoJSON.FeatureCollection<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  DistrictProperties
>;

export function getDistricts(): Promise<DistrictCollection> {
  return getJSON<DistrictCollection>("/districts");
}
