//! Local decoding and device playback run on Rodio's dedicated audio thread.
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink, Source};
use std::{fs::File, io::BufReader, path::Path, time::Duration};
pub struct Player {
    sink: Sink,
    _stream: OutputStream,
    duration: u64,
}
impl Player {
    pub fn open(path: &Path, volume: u32) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("Áudio: {e}"))?;
        let source = Decoder::try_from(BufReader::with_capacity(262144, file))
            .map_err(|e| format!("Não foi possível decodificar o áudio: {e}"))?;
        let duration = source
            .total_duration()
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut stream = OutputStreamBuilder::open_default_stream()
            .map_err(|e| format!("Dispositivo de áudio: {e}"))?;
        stream.log_on_drop(false);
        let sink = Sink::connect_new(stream.mixer());
        sink.set_volume(volume as f32 / 100.0);
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
        self.sink.set_volume(volume as f32 / 100.0);
    }
}
