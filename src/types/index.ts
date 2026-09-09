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
  cover_thumbnail_path?: string;
  is_vault: boolean;
  vault_type?: string;
  is_favorite: boolean;
  photo_count?: number;
  created_at?: string;
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

export interface UnlabeledClusterItem {
  cluster_id: string;
  photo_count: number;
  face_count: number;
  medoid_face_id?: number;
  anchor_face_ids: number[];
}

export interface FaceScanStatus {
  is_scanning: boolean;
  total_photos: number;
  scanned_photos: number;
  faces_found: number;
  current_photo?: string | null;
  error?: string | null;
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

export interface MediaCounts {
  images: number;
  videos: number;
  documents: number;
  favorites: number;
  albums: number;
  people: number;
  total_media: number;
}

export interface AppStorageStats {
  total_bytes: number;
  media_bytes: number;         // Photos, videos, proxies & thumbnails combined
  app_system_bytes: number;    // Database, search indices & AI models
  originals_bytes: number;
  thumbnails_bytes: number;
  previews_bytes: number;
  database_bytes: number;
  models_bytes: number;
}

export interface DriveStorageStats {
  drive_letter: string;
  volume_name: string;
  drive_type: string;
  is_internal: boolean;
  total_bytes: number;
  free_bytes: number;
  app_consumed_bytes: number;
  system_other_bytes: number;
  other_files_bytes: number;
  disclaimer: string;
}


export interface DashboardOverview {
  media_counts: MediaCounts;
  app_storage: AppStorageStats;
  drive_storage: DriveStorageStats;
}

export interface StorySlide {
  photo_id: number;
  filename: string;
  taken_at?: string;
  year_label: string;
  transition_type: string;
  focal_x: number;
  focal_y: number;
}

export interface StoryModel {
  id: number;
  title: string;
  story_type: string;
  vibe_mood: string;
  music_track_path: string;
  cover_photo_id?: number | null;
  slides: StorySlide[];
}

