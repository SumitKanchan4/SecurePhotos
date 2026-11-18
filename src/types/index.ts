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
  original_file_size?: number;
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
  duration?: number;
  is_optimized: boolean;
  is_enhanced: boolean;
  /** H10: set on an improved copy; points to its original. */
  derived_from_id?: number | null;
  /** H10: what was improved ('colour', 'fade', 'faces', 'scratches', comma-joined). */
  ai_kind?: string | null;
  caption?: string;
  content_tags?: string;
  is_document?: boolean;
  ocr_text?: string;
  album_names?: string;
  is_pinned?: boolean;
}

/**
 * One photo in the Photos timeline (redesign R2): only what the grid needs.
 * Full details come from /api/photos/details when the photo is opened.
 */
export interface TimelinePhoto {
  id: number;
  taken_at: string | null;
  width: number;
  height: number;
  is_video: boolean;
  is_favorite: boolean;
  is_optimized: boolean;
  is_enhanced: boolean;
  /** H10: an improved copy made with AI (the grid shows one icon per fix). */
  is_ai?: boolean;
  /** What the improved copy had done: "colour", "fade", "faces", "scratches". */
  ai_kinds?: string[];
  /** After-import P4: text, faces, old-photo check, duplicates or 8K still to do (quiet dot). */
  is_preparing?: boolean;
  /** A video's length in seconds (0 or missing: unknown). */
  duration?: number;
}

/** /api/photos/timeline: rows are [id, taken_at, width, height, "p" | "v", flags, seconds]. */
export interface TimelineResponse {
  total: number;
  items: ([number, string | null, number, number, string, number] | [number, string | null, number, number, string, number, number])[];
}

/** /api/photos/{id}/context: what the viewer's details panel shows besides EXIF (redesign R3). */
export interface PhotoContext {
  people: { id: number; name: string; face_id: number | null }[];
  albums: { id: number; name: string }[];
  imported_at: string | null;
  copied_into_library: boolean;
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
  /** Oldest and newest photo dates in the album (album list only). */
  first_taken_at?: string | null;
  last_taken_at?: string | null;
}

export interface VaultAlbumItem {
  id: number;
  name: string;
  description?: string;
  is_vault: boolean;
  is_favorite: boolean;
  photo_count: number;
  cover_photo_id?: number | null;
  created_at?: string | null;
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

/** /api/people/merge-suggestions: "Same person?" (redesign R5). */
export interface MergeSuggestion {
  person_id: number;
  person_name: string;
  person_photo_count: number;
  person_face_id: number | null;
  cluster_id: string;
  cluster_photo_count: number;
  cluster_face_id: number | null;
  similarity: number;
  /** Up to four clear faces per side, best first (round 1, #24). */
  person_face_ids?: number[];
  cluster_face_ids?: number[];
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

export interface VcRedistPrerequisite {
  installed: boolean;
  download_url: string;
}

export interface SystemPrerequisites {
  python: PythonPrerequisite;
  backend: BackendPrerequisite;
  vcredist: VcRedistPrerequisite;
  all_ready: boolean;
  error_message?: string | null;
}

export interface OptimizationProgress {
  is_active: boolean;
  active_photo_id: number | null;
  active_filename: string | null;
  item_progress: number;
  completed_count: number;
  total_count: number;
  last_completed_photo_id?: number | null;
  /** "on_battery" while the battery guard is waiting for the charger. */
  paused_reason?: string | null;
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
  images_bytes?: number;
  videos_bytes?: number;
  thumbnails_bytes: number;
  previews_bytes: number;
  database_bytes: number;
  models_bytes: number;
  orphaned_bytes?: number;
  /** What the space is used for (R9a); sizes sum to total_bytes. */
  categories?: StorageCategory[];
}

export type StorageCategoryKey = "photos" | "videos" | "documents" | "vault" | "collages" | "music" | "trash" | "thumbnails" | "app";

export interface StorageCategory {
  key: StorageCategoryKey;
  bytes: number;
}

/** The library folder the engine is actually using (GET /api/system/library). */
export interface LibraryLocation {
  path: string;
  has_database: boolean;
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
  mime_type?: string;
}

export interface StoryModel {
  id: number;
  title: string;
  story_type: string;
  vibe_mood: string;
  music_track_path: string;
  audio_url?: string | null;
  cover_photo_id?: number | null;
  is_saved?: boolean;
  slides_count?: number;
  /** Oldest and newest photo dates in the story (story list only). */
  first_taken_at?: string | null;
  last_taken_at?: string | null;
  /** A few of the story's photos, in story order (story list only; round 2, #8). */
  preview_photo_ids?: number[];
  slides: StorySlide[];
}

export interface SuggestedCollage {
  id: string;
  title: string;
  subtitle: string;
  cluster_type: 'person' | 'event' | 'favorites' | 'seasonal' | string;
  layout: 'mosaic' | 'hero_grid' | 'treemap' | string;
  photo_ids: number[];
  preview_photo_ids: number[];
  taken_at?: string | null;
  is_already_saved: boolean;
  saved_photo_id?: number | null;
}

export interface MusicTrackItem {
  id: string;
  filename: string;
  title: string;
  artist: string;
  mood: "auto" | "nostalgic" | "upbeat" | "acoustic" | "cinematic" | string;
  detected_mood?: string | null;
  bpm?: number | null;
  auto_tagged: boolean;
  detected_genre?: string | null;
  duration_seconds: number;
  duration_formatted: string;
  file_size_bytes: number;
  file_size_formatted: string;
  stream_url: string;
}


export interface StoriesInsights {
  total_stories: number;
  most_captured_people: Array<{
    id: number;
    name: string;
    relationship_type?: string;
    is_close_one: boolean;
    photo_count: number;
  }>;
  photos_by_month: Array<{
    month: string;
    count: number;
  }>;
  time_of_day_distribution: Array<{
    period: string;
    count: number;
  }>;
  camera_breakdown: Array<{
    camera: string;
    count: number;
  }>;
  top_years: Array<{
    yr: string;
    count: number;
  }>;
}

export interface DuplicateGroupItem {
  group_id: string;
  match_type: 'exact' | 'near';
  distance: number;
  suggested_best_photo_id: number;
  best_reason: string;
  reclaimable_bytes: number;
  photos: PhotoItem[];
}

export interface DuplicateSummaryResponse {
  total_groups: number;
  total_duplicate_photos: number;
  reclaimable_bytes: number;
  exact_groups?: number;
  similar_groups?: number;
  total_library_photos?: number;
}

export interface ImportProgressState {
  is_active: boolean;
  total_count: number;
  completed_count: number;
  current_filename: string;
  album_id: number | null;
  album_name: string | null;
  imported: number;
  skipped: number;
  failed?: number;
}

export interface ImportResponse {
  total_found: number;
  imported: number;
  skipped: number;
  failed: number;
  imported_photo_ids: number[];
  album_linked_count?: number;
}


export interface OptimizationStatusResponse {
  service_status: "processing" | "paused" | "idle";
  videos_total: number;
  videos_optimized: number;
  videos_pending: number;
  images_total: number;
  images_optimized: number;
  images_pending: number;
  overall_progress_percent: number;
  active_filename?: string | null;
  active_item_progress: number;
  reclaimed_bytes: number;
}


export interface VideoOptimizationPlan {
  status: 'compressible' | 'enhanceable' | 'already_optimized' | 'standard';
  action: 'compress' | 'enhance' | 'none';
  label: string;
  target_resolution?: string;
  projected_savings_bytes: number;
  projected_savings_pct: number;
  reason: string;
}

export interface VideoCandidate {
  id: number;
  filename: string;
  filepath: string;
  file_size: number;
  width?: number;
  height?: number;
  duration?: number;
  mime_type: string;
  codec?: string;
  bitrate?: number;
  fps?: number;
  thumbnail_path?: string;
  is_enhanced?: boolean;
  optimization_plan: VideoOptimizationPlan;
}

export interface VideoSummary {
  runtime_available: boolean;
  encoder_info?: {
    encoder: string;
    type: 'hardware' | 'cpu';
    crf_param?: string;
    preset_param?: string;
    default_crf?: number;
    default_preset?: string;
  };
  total_videos: number;
  total_bytes: number;
  compressible_count: number;
  enhanceable_count: number;
  optimized_count: number;
  /** What making the compressible videos smaller would free (the engine's field name). */
  projected_reclaimable_bytes: number;
}

export interface VideoOptimizationProgress {
  is_active: boolean;
  total_count: number;
  completed_count: number;
  active_video_id?: number | null;
  active_filename?: string | null;
  item_progress: number;
  total_reclaimed_bytes?: number;
}

export interface SearchPhotoItem {
  id: number;
  filename: string;
  filepath: string;
  mime_type: string;
  width?: number | null;
  height?: number | null;
  is_optimized?: boolean;
  is_enhanced?: boolean;
  thumbnail_path?: string | null;
  taken_at?: string | null;
  is_favorite: boolean;
  is_document: boolean;
  caption?: string | null;
  ocr_text?: string | null;
  match_reason?: string | null;
}

export interface SearchAlbumItem {
  id: number;
  name: string;
  cover_photo_id?: number | null;
  cover_thumbnail_path?: string | null;
  photo_count: number;
}

export interface SearchPersonItem {
  id: number;
  name: string;
  relationship_type?: string | null;
  confirmed_count: number;
  cover_face_id?: number | null;
}

export interface SearchResponse {
  query: string;
  total_photos: number;
  photos: SearchPhotoItem[];
  albums: SearchAlbumItem[];
  people: SearchPersonItem[];
  detected_intent?: {
    type?: string | null;
    year?: string | null;
    month?: string | null;
  } | null;
  suggestions: string[];
}

export type DocumentCategory = 'receipt' | 'identity' | 'tax' | 'medical' | 'legal' | 'warranty' | 'other' | 'all';

export interface DocumentItem {
  id: number;
  title: string;
  filename: string;
  filepath: string;
  category: string;
  date: string;
  file_size: string;
  file_size_bytes: number;
  mime_type: string;
  extracted_text: string;
  is_encrypted: boolean;
  vault_type?: string | null;
  thumbnail_path?: string | null;
  preview_path?: string | null;
  is_pinned?: boolean;
}

export interface DocumentScanResult {
  total_scanned: number;
  newly_detected: number;
  categories: Record<string, number>;
}

export interface GridCardData {
  card_id: string;
  cells: Record<string, string>;
  card_token: string;
  grid_salt: string;
}


