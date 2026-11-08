import unittest

from audio_source import choose


class AudioSourceTests(unittest.TestCase):
    def candidate(self, title, **fields):
        return dict(id="abcdefghijk", title=title, duration=200, **fields)

    def test_prefers_audio_and_checks_recording_duration(self):
        lyrics = self.candidate("Singer - Song (Lyrics)")
        audio = self.candidate("Singer - Song (Official Audio)")
        clip = self.candidate("Singer - Song (Official Music Video)")
        self.assertIs(choose([clip, lyrics, audio], "Song", "Singer", 200), audio)
        audio["duration"] = 500
        self.assertIs(choose([audio, lyrics], "Song", "Singer", 200), lyrics)

    def test_never_falls_back_to_a_clip_cover_or_live_recording(self):
        for edition in (
            "Music Video",
            "Official Video",
            "Cover",
            "Live",
            "Remix",
            "Karaoke",
        ):
            with self.subTest(edition=edition):
                self.assertIsNone(
                    choose(
                        [self.candidate(f"Singer - Song ({edition})")],
                        "Song",
                        "Singer",
                        200,
                    )
                )
        self.assertIsNone(
            choose(
                [self.candidate("Someone Else - Song (Lyrics)")], "Song", "Singer", 200
            )
        )

    def test_whole_word_markers_do_not_reject_believe_or_discover(self):
        item = self.candidate("Singer - Believe (Lyrics)")
        self.assertIs(choose([item], "Believe", "Singer", 200), item)
        self.assertIsNone(choose([item], "Lie", "Singer", 200))

    def test_explicit_editions_and_topic_releases_are_accepted(self):
        item = self.candidate("Song", uploader="Singer - Topic")
        self.assertIs(choose([item], "Song", "Singer", 200), item)
        live = self.candidate("Singer - Song (Live) (Official Audio)")
        self.assertIs(choose([live], "Song (Live)", "Singer", 200), live)


if __name__ == "__main__":
    unittest.main()
