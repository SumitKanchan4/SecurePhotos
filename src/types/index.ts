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
