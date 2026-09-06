/**
 * Core domain types and interfaces for SecurePhotos 2.0.
 */

export interface VolumeInfo {
  drive_letter: string;
  volume_name: string;
  volume_serial: string;
  file_system: string;
  is_ready: boolean;
  free_bytes: number;
  total_bytes: number;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded';
  app_name: string;
  app_version: string;
  database_ok: boolean;
  data_dir: string;
  connected_volumes: number;
}

export interface PhotoItem {
  id: number;
  filename: string;
  filepath: string;
  file_size: number;
  mime_type: string;
  width?: number;
  height?: number;
  taken_at?: string;
  camera_make?: string;
  camera_model?: string;
  latitude?: number;
  longitude?: number;
  iso?: number;
  aperture?: number;
  shutter_speed?: string;
  focal_length?: number;
  is_favorite: boolean;
  is_encrypted: boolean;
  vault_type?: 'documents' | 'private' | null;
  thumbnail_path?: string;
  preview_path?: string;
  is_optimized: boolean;
  is_enhanced: boolean;
  caption?: string;
  content_tags?: string;
}

export interface AlbumItem {
  id: number;
  name: string;
  description?: string;
  cover_photo_id?: number;
  is_vault: boolean;
  vault_type?: string;
  is_favorite: boolean;
  photo_count?: number;
}

export interface PersonItem {
  id: number;
  name: string;
  affinity_score: number;
  relationship_type?: string;
  is_close_one: boolean;
  confirmed_count: number;
  cover_face_id?: number;
}

export interface PythonPrerequisite {
  installed: boolean;
  version: string | null;
  executable: string | null;
  meets_minimum_version: boolean;
  minimum_required: string;
}

export interface BackendPrerequisite {
  running: boolean;
  port: number;
  url: string;
}

export interface SystemPrerequisites {
  python: PythonPrerequisite;
  backend: BackendPrerequisite;
  all_ready: boolean;
}

export interface OptimizationProgress {
  is_active: boolean;
  active_photo_id: number | null;
  active_filename: string | null;
  item_progress: number;
  completed_count: number;
  total_count: number;
  last_completed_photo_id?: number | null;
}

export interface TimelineYearItem {
  year: string;
  count: number;
}

export interface TimelineYearsData {
  total_count: number;
  years: TimelineYearItem[];
}

