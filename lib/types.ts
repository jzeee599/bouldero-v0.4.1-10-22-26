export type Hold = {
  id: string;
  order_index: number;
  x: number;
  y: number;
  is_top: boolean;
};
export type Project = {
  id: string;
  name: string;
  grade: string;
  gym: string;
  photo_url: string;
  photo_optional?: boolean;
  storage_photo_path?: string | null;
  status: "active" | "sent" | "archived";
  created_at: string;
  sent_at: string | null;
  holds: Hold[];
  route_mode: "mapped" | "count_only";
  source_project_id: string | null;
  finish_type: "hold" | "top_out";
  notes: string;
  wall_area?: string;
  purpose: "project" | "warm_up" | "training";
};

export type ClimbingSession = {
  id: string;
  gym: string;
  started_at: string;
  ended_at: string | null;
};

export type Attempt = {
  id: string;
  project_id: string;
  session_id: string;
  result: "attempt" | "sent";
  started_hold_id: string | null;
  ended_hold_id: string | null;
  hold_result?: "controlled" | "touched" | null;
  topped_out: boolean;
  notes: string;
  created_at: string;
};

export type GymMapMarker = {
  project_id: string;
  x: number;
  y: number;
};

export type GymMap = {
  storage_image_path?: string;
  id: string;
  gym: string;
  image_url: string;
  markers: GymMapMarker[];
  updated_at: string;
};
