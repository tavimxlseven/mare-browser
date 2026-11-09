//! Local decoding and device playback run on Rodio's dedicated audio thread.
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink, Source};
use std::{fs::File, io::BufReader, path::Path, time::Duration};
pub struct Player {
    sink: Sink,
    _stream: OutputStream,
    duration: u64,
}
fn decode(path: &Path) -> Result<Decoder<BufReader<File>>, String> {
    let file = File::open(path).map_err(|e| format!("Áudio: {e}"))?;
    let length = file.metadata().map_err(|e| format!("Áudio: {e}"))?.len();
    Decoder::builder()
        .with_data(BufReader::with_capacity(262144, file))
        .with_byte_len(length)
        .with_seekable(true)
        .build()
        .map_err(|e| format!("Não foi possível decodificar o áudio: {e}"))
}
impl Player {
    pub fn open(path: &Path, volume: u32) -> Result<Self, String> {
        let source = decode(path)?;
        let duration = source
            .total_duration()
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut stream = OutputStreamBuilder::open_default_stream()
            .map_err(|e| format!("Dispositivo de áudio: {e}"))?;
        stream.log_on_drop(false);
        let sink = Sink::connect_new(stream.mixer());
        sink.set_volume(volume_gain(volume));
        sink.append(source);
        Ok(Self {
            sink,
            _stream: stream,
            duration,
        })
    }
    pub fn snapshot(&self) -> (&'static str, u64, u64) {
        let ended = self.sink.empty();
        (
            if ended {
                "stopped"
            } else if self.sink.is_paused() {
                "paused"
            } else {
                "playing"
            },
            if ended {
                self.duration
            } else {
                self.sink.get_pos().as_millis() as u64
            },
            self.duration,
        )
    }
    pub fn pause(&self) {
        self.sink.pause();
    }
    pub fn resume(&self) {
        self.sink.play();
    }
    pub fn seek(&self, position: u64) -> Result<(), String> {
        self.sink
            .try_seek(Duration::from_millis(position))
            .map_err(|e| format!("Não foi possível buscar nesta faixa: {e}"))
    }
    pub fn volume(&self, volume: u32) {
        self.sink.set_volume(volume_gain(volume));
    }
}
fn volume_gain(value: u32) -> f32 {
    (value.min(100) as f32 / 100.0).powi(2)
}
#[cfg(test)]
mod tests {
    #[test]
    fn a_local_file_can_seek_forward_and_back_without_an_audio_device() {
        use rodio::Source;
        let path = std::env::temp_dir().join(format!(
            "mare-seek-{}-{}.wav",
            std::process::id(),
            crate::model::now_ms()
        ));
        let mut wav = Vec::new();
        wav.extend(b"RIFF");
        wav.extend(16036u32.to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16u32.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(8000u32.to_le_bytes());
        wav.extend(16000u32.to_le_bytes());
        wav.extend(2u16.to_le_bytes());
        wav.extend(16u16.to_le_bytes());
        wav.extend(b"data");
        wav.extend(16000u32.to_le_bytes());
        wav.resize(16044, 0);
        std::fs::write(&path, wav).unwrap();
        let mut source = super::decode(&path).unwrap();
        source
            .try_seek(std::time::Duration::from_millis(700))
            .unwrap();
        assert!(source.next().is_some());
        source
            .try_seek(std::time::Duration::from_millis(100))
            .unwrap();
        assert!(source.next().is_some());
        drop(source);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn volume_curve_has_fine_low_level_control_and_bounded_gain() {
        assert_eq!(super::volume_gain(0), 0.0);
        assert_eq!(super::volume_gain(100), 1.0);
        assert_eq!(super::volume_gain(200), 1.0);
        assert!(super::volume_gain(10) < 0.011);
        assert!(super::volume_gain(50) > super::volume_gain(49));
    }
}
