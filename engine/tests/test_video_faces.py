"""T30 (owner, 2026-11-21): faces are found on frames through a video, each person kept once."""

import subprocess

import pytest

from engine.services import video_faces
from engine.services.video_runtime import get_ffmpeg_path


def _face(embedding, quality, box_x=0.1):
    return {"embedding": embedding, "quality_score": quality, "box_x": box_x, "box_y": 0.1, "box_w": 0.2, "box_h": 0.2}


def test_frames_are_spread_through_the_video_away_from_the_edges():
    times = video_faces.frame_times(100.0, 8)
    assert len(times) == 8 and times[0] == 5.0 and times[-1] == 95.0
    assert video_faces.frame_times(1.0) == [0.5]
    assert video_faces.frame_times(0.0) == [0.0]


def test_the_same_person_on_several_frames_is_kept_once_at_their_sharpest():
    alice, bob = [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]
    alice_blurry, alice_sharp = _face(alice, 0.3), _face([0.98, 0.199, 0.0], 0.9)
    kept = video_faces.distinct_faces([[alice_blurry], [alice_sharp, _face(bob, 0.5)], []])
    assert len(kept) == 2
    assert alice_sharp in kept and alice_blurry not in kept


@pytest.mark.skipif(not get_ffmpeg_path(), reason="FFmpeg not available")
def test_faces_in_a_real_video_are_looked_for_on_every_sampled_frame(tmp_path):
    video = tmp_path / "clip.mp4"
    subprocess.run(
        [get_ffmpeg_path(), "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=10", "-pix_fmt", "yuv420p", str(video)],
        check=True, capture_output=True,
    )
    seen = []

    def fake_detect(frame):
        seen.append(frame.size)
        return [_face([1.0, 0.0], 0.5)]  # the same person on every frame

    faces = video_faces.faces_in_video(video, 4.0, fake_detect)
    assert len(seen) == video_faces.FRAMES and set(seen) == {(320, 240)}
    assert len(faces) == 1


def test_an_unreadable_video_gives_no_faces_so_the_preview_is_used(tmp_path):
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"not a video")
    assert video_faces.faces_in_video(broken, 3.0, lambda frame: [_face([1.0], 0.5)]) == []
