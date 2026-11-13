package org.mare.music;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import androidx.media3.common.*;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.offline.*;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.*;
import java.util.*;
import org.json.*;

@UnstableApi
public final class PlaybackService extends MediaSessionService {
  private static PlaybackService instance;
  private ExoPlayer player;
  private MediaSession session;
  private String origin = "", account = "", scope = "", error = "";
  private final Map<String, JSONObject> catalog = new HashMap<>();
  private List<String> context = new ArrayList<>();
  private String repeat = "off";
  private final Handler handler = new Handler();
  private final Runnable checkpoint =
      new Runnable() {
        public void run() {
          savePlayback();
          handler.postDelayed(this, 3000);
        }
      };
  private final Runnable sleep = () -> player.pause();

  private void savePlayback() {
    if (scope.isEmpty() || player == null || player.getCurrentMediaItem() == null) return;
    JSONObject saved =
        MusicApi.json(
            "id",
            player.getCurrentMediaItem().mediaId,
            "position",
            player.getCurrentPosition(),
            "queue",
            new JSONArray(remaining()),
            "context",
            new JSONArray(context),
            "repeat",
            repeat,
            "volume",
            player.getVolume());
    getSharedPreferences("playback-" + scope, 0)
        .edit()
        .putString("state", saved.toString())
        .apply();
  }

  private void restorePlayback() {
    if (player.getMediaItemCount() > 0) return;
    try {
      JSONObject saved =
          new JSONObject(getSharedPreferences("playback-" + scope, 0).getString("state", "{}"));
      JSONArray tracks =
          new JSONArray(getSharedPreferences("playback-" + scope, 0).getString("catalog", "[]"));
      if (tracks != null)
        for (int i = 0; i < tracks.length(); i++) {
          JSONObject t = tracks.getJSONObject(i);
          if (validId(t.optString("id"))) catalog.put(t.getString("id"), t);
        }
      List<String> timeline = new ArrayList<>();
      String id = saved.optString("id");
      if (validId(id)) timeline.add(id);
      timeline.addAll(ids(saved.optJSONArray("queue")));
      List<MediaItem> media = items(timeline);
      if (media.isEmpty()) return;
      context = ids(saved.optJSONArray("context"));
      repeat = saved.optString("repeat", "off");
      player.setRepeatMode("one".equals(repeat) ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
      player.setVolume((float) saved.optDouble("volume", 1));
      player.setMediaItems(media, 0, Math.max(0, saved.optLong("position")));
      player.setPlayWhenReady(false);
    } catch (Exception ignored) {
    }
  }

  @Override
  public void onCreate() {
    super.onCreate();
    instance = this;
    player =
        new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(AudioStore.source(this)))
            .build();
    player.setAudioAttributes(
        new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build(),
        true);
    player.setHandleAudioBecomingNoisy(true);
    player.setWakeMode(C.WAKE_MODE_NETWORK);
    PendingIntent open =
        PendingIntent.getActivity(
            this,
            0,
            new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    session = new MediaSession.Builder(this, player).setSessionActivity(open).build();
    DefaultMediaNotificationProvider notification =
        new DefaultMediaNotificationProvider.Builder(this)
            .setChannelId("mare-playback")
            .setChannelName(R.string.playback_channel_name)
            .build();
    notification.setSmallIcon(R.drawable.ic_notification_music);
    setMediaNotificationProvider(notification);
    handler.postDelayed(checkpoint, 3000);
    player.addListener(
        new Player.Listener() {
          @Override
          public void onPlayerError(PlaybackException failure) {
            error =
                "Não foi possível tocar esta faixa. Confira a conexão ou atualize a fonte nos"
                    + " ajustes.";
          }

          @Override
          public void onPlaybackStateChanged(int state) {
            if (state == Player.STATE_ENDED && "all".equals(repeat) && !context.isEmpty()) {
              List<MediaItem> items = items(context);
              if (!items.isEmpty()) {
                player.setMediaItems(items);
                player.prepare();
                player.play();
              }
            }
          }
        });
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && "org.mare.music.COMMAND".equals(intent.getAction())) {
      try {
        command(new JSONObject(intent.getStringExtra("command")));
      } catch (Exception ignored) {
        error = "Não foi possível atualizar o player nativo.";
      }
      return START_NOT_STICKY;
    }
    return super.onStartCommand(intent, flags, startId);
  }

  private void command(JSONObject data) throws JSONException {
    String requestedOrigin = ServerAddress.normalize(data.getString("origin"));
    String action = data.getString("action");
    if (action.equals("logout")) {
      player.stop();
      player.clearMediaItems();
      AudioStore.manager(this).setStopReason(null, 1);
      getSharedPreferences("playback-" + scope, 0).edit().clear().apply();
      AudioStore.clearAccount(this, scope);
      AudioStore.authenticate("");
      catalog.clear();
      account = "";
      scope = "";
      error = "";
      stopSelf();
      return;
    }
    String requestedAccount = data.optString("account", account);
    if (requestedAccount.isEmpty()) return;
    if (!origin.equals(requestedOrigin) || !account.equals(requestedAccount)) {
      savePlayback();
      player.stop();
      player.clearMediaItems();
      AudioStore.manager(this).setStopReason(null, 1);
      origin = requestedOrigin;
      account = requestedAccount;
      scope = AudioStore.scope(origin, account);
      catalog.clear();
      context.clear();
    }
    AudioStore.authenticate(data.optString("cookie"));
    JSONArray tracks = data.optJSONArray("tracks");
    if (tracks != null)
      for (int i = 0; i < tracks.length(); i++) {
        JSONObject track = tracks.getJSONObject(i);
        if (validId(track.optString("id"))) catalog.put(track.getString("id"), track);
      }
    if (tracks != null)
      getSharedPreferences("playback-" + scope, 0)
          .edit()
          .putString("catalog", tracks.toString())
          .apply();
    switch (action) {
      case "configure":
        restorePlayback();
        break;
      case "checkpoint":
        savePlayback();
        break;
      case "sleep":
        handler.removeCallbacks(sleep);
        if (data.optLong("minutes") > 0)
          handler.postDelayed(sleep, data.optLong("minutes") * 60000);
        break;
      case "start":
        {
          error = "";
          repeat = data.optString("repeat", "off");
          context = ids(data.optJSONArray("context"));
          List<String> ids = new ArrayList<>();
          ids.add(data.getString("id"));
          ids.addAll(ids(data.optJSONArray("queue")));
          List<MediaItem> items = items(ids);
          if (items.isEmpty()) return;
          player.setRepeatMode(
              "one".equals(repeat) ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
          player.setMediaItems(items, 0, Math.max(0, data.optLong("position")));
          player.prepare();
          player.play();
          break;
        }
      case "queue":
        {
          MediaItem current = player.getCurrentMediaItem();
          if (current == null || !current.mediaId.equals(data.optString("id"))) break;
          repeat = data.optString("repeat", "off");
          context = ids(data.optJSONArray("context"));
          player.setRepeatMode(
              "one".equals(repeat) ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
          List<String> desired = ids(data.optJSONArray("queue"));
          List<String> remaining = remaining();
          if (!desired.equals(remaining)) {
            int at = player.getCurrentMediaItemIndex() + 1;
            player.removeMediaItems(at, player.getMediaItemCount());
            player.addMediaItems(items(desired));
          }
          break;
        }
      case "play":
        if (player.getPlaybackState() == Player.STATE_IDLE)
          player.seekTo(player.getCurrentMediaItemIndex(), player.getCurrentPosition());
        if (player.getMediaItemCount() > 0) {
          if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
          player.play();
        }
        break;
      case "pause":
        player.pause();
        break;
      case "stop":
        player.stop();
        player.clearMediaItems();
        break;
      case "seek":
        player.seekTo(Math.max(0, data.optLong("position")));
        break;
      case "volume":
        player.setVolume((float) Math.max(0, Math.min(1, data.optDouble("value", 1))));
        break;
      case "download":
        {
          for (String id : ids(data.optJSONArray("ids"))) {
            if (!catalog.containsKey(id) || !"ready".equals(catalog.get(id).optString("status")))
              continue;
            DownloadRequest request =
                new DownloadRequest.Builder(scope + "/" + id, Uri.parse(origin + "/media/" + id))
                    .setCustomCacheKey(scope + "/" + id)
                    .setMimeType("audio/mp4")
                    .build();
            DownloadService.sendAddDownload(this, MusicDownloadService.class, request, true);
            DownloadService.sendSetStopReason(
                this, MusicDownloadService.class, request.id, 0, true);
            DownloadService.sendResumeDownloads(this, MusicDownloadService.class, true);
          }
          break;
        }
      case "remove":
        {
          String id = data.optString("id");
          if (validId(id))
            DownloadService.sendRemoveDownload(
                this, MusicDownloadService.class, scope + "/" + id, true);
          break;
        }
    }
  }

  static boolean validId(String id) {
    return id.matches("[A-Za-z0-9_-]{1,128}");
  }

  private static List<String> ids(JSONArray array) {
    List<String> result = new ArrayList<>();
    if (array != null)
      for (int i = 0; i < array.length() && i < 10000; i++) {
        String id = array.optString(i);
        if (validId(id)) result.add(id);
      }
    return result;
  }

  private List<MediaItem> items(List<String> ids) {
    List<MediaItem> result = new ArrayList<>();
    for (String id : ids) {
      JSONObject track = catalog.get(id);
      if (track == null || !validId(id)) continue;
      MediaMetadata.Builder metadata =
          new MediaMetadata.Builder()
              .setTitle(track.optString("title"))
              .setArtist(track.optString("artist"))
              .setAlbumTitle("Maré Música")
              .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
              .setIsPlayable(true);
      String art = track.optString("art");
      if (art.startsWith("https://")) metadata.setArtworkUri(Uri.parse(art));
      result.add(
          new MediaItem.Builder()
              .setMediaId(id)
              .setUri(origin + "/media/" + id)
              .setCustomCacheKey(scope + "/" + id)
              .setMimeType("audio/mp4")
              .setMediaMetadata(metadata.build())
              .build());
    }
    return result;
  }

  private List<String> remaining() {
    List<String> result = new ArrayList<>();
    for (int i = player.getCurrentMediaItemIndex() + 1; i < player.getMediaItemCount(); i++)
      result.add(player.getMediaItemAt(i).mediaId);
    return result;
  }

  static JSONObject snapshot(Context context) {
    JSONObject value = new JSONObject();
    PlaybackService service = instance;
    try {
      if (service == null) return value;
      ExoPlayer player = service.player;
      MediaItem track = player.getCurrentMediaItem();
      value
          .put("account", service.account)
          .put("id", track == null ? JSONObject.NULL : track.mediaId)
          .put(
              "playing",
              player.getPlayWhenReady() && player.getPlaybackState() != Player.STATE_ENDED)
          .put("position", player.getCurrentPosition())
          .put("duration", Math.max(0, player.getDuration()))
          .put("volume", player.getVolume())
          .put("queue", new JSONArray(service.remaining()))
          .put("repeat", service.repeat)
          .put("offline", AudioStore.completed(context, service.scope))
          .put("error", service.error);
      value.put("failed", AudioStore.byState(context, service.scope, Download.STATE_FAILED));
    } catch (Exception ignored) {
    }
    return value;
  }

  @Override
  public MediaSession onGetSession(MediaSession.ControllerInfo controller) {
    return session;
  }

  @Override
  public void onDestroy() {
    savePlayback();
    instance = null;
    handler.removeCallbacksAndMessages(null);
    player.release();
    session.release();
    super.onDestroy();
  }
}
