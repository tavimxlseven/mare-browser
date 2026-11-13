package org.mare.music;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.view.*;
import android.widget.*;
import androidx.media3.common.util.UnstableApi;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Native Android screens. Playback and offline storage belong to the service. */
@UnstableApi
public final class MainActivity extends Activity {
  private static final int BG = 0xff090a0d,
      PANEL = 0xff1b1d23,
      TEXT = 0xfff5f5f7,
      MUTED = 0xff999da8,
      PINK = 0xffff527b;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final java.util.Map<ImageView, String> loadedImages = new java.util.WeakHashMap<>();
  private final java.util.Set<ImageView> loadingImages =
      java.util.Collections.newSetFromMap(new java.util.WeakHashMap<>());
  private final ExecutorService requests = Executors.newSingleThreadExecutor(),
      images = Executors.newFixedThreadPool(3);
  private final android.util.LruCache<String, Bitmap> covers =
      new android.util.LruCache<String, Bitmap>(8 * 1024 * 1024) {
        protected int sizeOf(String k, Bitmap b) {
          return b.getAllocationByteCount();
        }
      };
  private MusicApi api;
  private JSONObject library = new JSONObject(), state = new JSONObject();
  private final ArrayList<String> queue = new ArrayList<>(), context = new ArrayList<>();
  private final Set<String> offline = new HashSet<>(), pending = new HashSet<>();
  private LinearLayout content;
  private TextView miniTitle, miniArtist, miniPlay, activity;
  private ImageView miniCover;
  private String tab = "Biblioteca", selected = "", current = "", repeat = "off";
  private boolean active, refreshing, shuffle;
  private long refreshed;
  private Dialog player;
  private TextView playerPlay, elapsed;
  private SeekBar seek;
  private boolean scrubbing;
  private final Runnable pulse =
      new Runnable() {
        public void run() {
          if (!active) return;
          adopt(PlaybackService.snapshot(MainActivity.this));
          if (!api.account.isEmpty()
              && !refreshing
              && System.currentTimeMillis() - refreshed > 8000) refresh(false);
          main.postDelayed(this, 700);
        }
      };

  @Override
  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    api = new MusicApi(this);
    getWindow().setStatusBarColor(BG);
    getWindow().setNavigationBarColor(BG);
    if (Build.VERSION.SDK_INT >= 33
        && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
            != android.content.pm.PackageManager.PERMISSION_GRANTED)
      requestPermissions(new String[] {android.Manifest.permission.POST_NOTIFICATIONS}, 1);
    if (api.account.isEmpty()) login();
    else {
      try {
        library =
            new JSONObject(
                getSharedPreferences("library-" + AudioStore.scope(api.origin, api.account), 0)
                    .getString("cache", "{}"));
      } catch (Exception ignored) {
      }
      shell();
      command("configure", new JSONObject());
      refresh(true);
    }
  }

  private int dp(float n) {
    return (int) (n * getResources().getDisplayMetrics().density + .5f);
  }

  private GradientDrawable bg(int color, int radius) {
    GradientDrawable d = new GradientDrawable();
    d.setColor(color);
    d.setCornerRadius(dp(radius));
    return d;
  }

  private LinearLayout col() {
    LinearLayout v = new LinearLayout(this);
    v.setOrientation(LinearLayout.VERTICAL);
    return v;
  }

  private LinearLayout row() {
    LinearLayout v = new LinearLayout(this);
    v.setGravity(Gravity.CENTER_VERTICAL);
    return v;
  }

  private TextView text(String s, int size, int color) {
    TextView v = new TextView(this);
    v.setText(s);
    v.setTextSize(size);
    v.setTextColor(color);
    return v;
  }

  private TextView title(String s, int size) {
    TextView v = text(s, size, TEXT);
    v.setTypeface(null, Typeface.BOLD);
    return v;
  }

  private void gap(LinearLayout p, int h) {
    p.addView(new View(this), new LinearLayout.LayoutParams(1, dp(h)));
  }

  private TextView button(String s, boolean primary, Runnable action) {
    TextView v = text(s, 15, primary ? BG : TEXT);
    v.setGravity(Gravity.CENTER);
    v.setTypeface(null, Typeface.BOLD);
    v.setPadding(dp(16), dp(14), dp(16), dp(14));
    v.setBackground(bg(primary ? PINK : PANEL, 24));
    if (s.equals("▶")
        || s.equals("Ⅱ")
        || s.equals("❯")
        || s.equals("↤")
        || s.equals("↦")
        || s.equals("＋")
        || s.equals("•••")
        || s.equals("⌄")
        || s.equals("↑")) {
      v.setText("");
      v.setCompoundDrawablesWithIntrinsicBounds(
          new ControlIcon(s, primary ? BG : TEXT), null, null, null);
      v.setContentDescription(s);
    }
    v.setOnClickListener(
        w -> {
          v.animate()
              .alpha(.6f)
              .setDuration(60)
              .withEndAction(() -> v.animate().alpha(1).setDuration(150));
          action.run();
        });
    return v;
  }

  private EditText field(String hint, boolean password) {
    EditText v = new EditText(this);
    v.setTextSize(16);
    v.setTextColor(TEXT);
    v.setHintTextColor(MUTED);
    v.setHint(hint);
    v.setSingleLine();
    v.setPadding(dp(18), dp(16), dp(18), dp(16));
    v.setBackground(bg(PANEL, 16));
    if (password) v.setInputType(129);
    return v;
  }

  private void login() {
    LinearLayout page = col();
    page.setPadding(dp(28), dp(54), dp(28), dp(30));
    page.setBackgroundColor(BG);
    TextView brand = title("Maré", 52);
    brand.setTextColor(PINK);
    page.addView(brand);
    page.addView(title("Sua música.\nDo seu jeito.", 34));
    gap(page, 14);
    page.addView(
        text("Entre para encontrar sua biblioteca em todos os seus aparelhos.", 16, MUTED));
    gap(page, 32);
    EditText server = field("Servidor Maré", false);
    server.setText(api.origin);
    page.addView(server);
    gap(page, 12);
    EditText user = field("Usuário", false);
    page.addView(user);
    gap(page, 12);
    EditText password = field("Senha", true);
    page.addView(password);
    gap(page, 24);
    TextView status = text("", 14, PINK);
    TextView enter = button("Entrar", true, () -> {});
    enter.setOnClickListener(
        v -> {
          try {
            api.origin = ServerAddress.normalize(server.getText().toString());
          } catch (Exception error) {
            server.setError("Informe o endereço HTTPS do servidor.");
            return;
          }
          enter.setEnabled(false);
          status.setText("Conectando à sua biblioteca…");
          String name = user.getText().toString().trim(), secret = password.getText().toString();
          request(
              () -> {
                JSONObject r =
                    api.call("login", MusicApi.json("username", name, "password", secret));
                api.account = r.getJSONObject("user").getString("id");
                api.persist();
                return r;
              },
              r -> {
                password.setText("");
                library = new JSONObject();
                state = new JSONObject();
                offline.clear();
                pending.clear();
                queue.clear();
                context.clear();
                current = "";
                selected = "";
                tab = "Biblioteca";
                ((android.view.inputmethod.InputMethodManager)
                        getSystemService(INPUT_METHOD_SERVICE))
                    .hideSoftInputFromWindow(password.getWindowToken(), 0);
                shell();
                command("configure", new JSONObject());
                refresh(true);
              },
              error -> {
                enter.setEnabled(true);
                status.setText(error);
              });
        });
    page.addView(enter);
    gap(page, 16);
    page.addView(status);
    ScrollView scroll = new ScrollView(this);
    scroll.addView(page);
    setContentView(scroll);
  }

  private void shell() {
    LinearLayout root = col();
    root.setBackgroundColor(BG);
    root.setFitsSystemWindows(true);
    activity = text("", 13, PINK);
    activity.setPadding(dp(22), dp(8), dp(22), 0);
    activity.setVisibility(View.GONE);
    root.addView(activity);
    ScrollView scroll = new ScrollView(this);
    scroll.setVerticalScrollBarEnabled(false);
    scroll.setOnScrollChangeListener((v, x, y, ox, oy) -> visibleImages(content));
    content = col();
    content.setPadding(dp(22), dp(20), dp(22), dp(20));
    scroll.addView(content);
    root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
    LinearLayout mini = row();
    mini.setPadding(dp(12), dp(10), dp(12), dp(10));
    mini.setBackground(bg(PANEL, 22));
    miniCover = cover("", 48);
    mini.addView(miniCover, new LinearLayout.LayoutParams(dp(48), dp(48)));
    LinearLayout labels = col();
    labels.setPadding(dp(12), 0, dp(6), 0);
    miniTitle = title("Escolha uma música", 14);
    miniTitle.setMaxLines(1);
    miniTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
    miniArtist = text("Sua biblioteca está pronta", 12, MUTED);
    miniArtist.setMaxLines(1);
    labels.addView(miniTitle);
    labels.addView(miniArtist);
    mini.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
    labels.setOnClickListener(v -> openPlayer());
    miniPlay = button("▶", false, () -> toggle());
    mini.addView(miniPlay);
    mini.addView(button("❯", false, () -> next()));
    LinearLayout.LayoutParams m = new LinearLayout.LayoutParams(-1, dp(78));
    m.setMargins(dp(12), 0, dp(12), dp(8));
    root.addView(mini, m);
    LinearLayout nav = row();
    for (String label : new String[] {"Biblioteca", "Buscar", "Baixadas"}) {
      TextView item =
          button(
              label,
              false,
              () -> {
                tab = label;
                selected = "";
                render();
              });
      nav.addView(item, new LinearLayout.LayoutParams(0, dp(64), 1));
    }
    root.addView(nav);
    setContentView(root);
    render();
  }

  private JSONArray tracks() {
    JSONArray a = library.optJSONArray("tracks");
    return a == null ? new JSONArray() : a;
  }

  private JSONArray playlists() {
    JSONArray a = library.optJSONArray("playlists");
    return a == null ? new JSONArray() : a;
  }

  private JSONObject track(String id) {
    for (int i = 0; i < tracks().length(); i++) {
      JSONObject t = tracks().optJSONObject(i);
      if (id.equals(t.optString("id"))) return t;
    }
    return null;
  }

  private JSONObject playlist() {
    for (int i = 0; i < playlists().length(); i++) {
      JSONObject p = playlists().optJSONObject(i);
      if (selected.equals(p.optString("id"))) return p;
    }
    return null;
  }

  private ArrayList<JSONObject> visible() {
    ArrayList<JSONObject> list = new ArrayList<>();
    JSONObject p = playlist();
    if (p != null) {
      JSONArray ids = p.optJSONArray("tracks");
      if (ids != null)
        for (int i = 0; i < ids.length(); i++) {
          JSONObject t = track(ids.optString(i));
          if (t != null) list.add(t);
        }
    } else
      for (int i = 0; i < tracks().length(); i++) {
        JSONObject t = tracks().optJSONObject(i);
        if (!tab.equals("Baixadas") || offline.contains(t.optString("id"))) list.add(t);
      }
    return list;
  }

  private void render() {
    if (content == null) return;
    content.removeAllViews();
    LinearLayout header = row();
    header.addView(
        title(playlist() != null ? playlist().optString("name") : tab, 32),
        new LinearLayout.LayoutParams(0, -2, 1));
    header.addView(button("＋", false, () -> importMenu()));
    header.addView(button("•••", false, () -> settings()));
    content.addView(header);
    gap(content, 24);
    if (tab.equals("Buscar")) {
      EditText query = field("Músicas, artistas e álbuns", false);
      content.addView(query);
      gap(content, 12);
      content.addView(
          button(
              "Buscar",
              true,
              () -> {
                String q = query.getText().toString();
                request(
                    () -> api.call("search?q=" + URLEncoder.encode(q, "UTF-8"), null),
                    r -> {
                      while (content.getChildCount() > 5) content.removeViewAt(4);
                      JSONArray found = r.optJSONArray("tracks");
                      if (found != null)
                        for (int i = 0; i < found.length(); i++)
                          song(content, found.optJSONObject(i), null);
                    },
                    this::message);
              }));
      return;
    }
    if (playlist() != null) {
      JSONObject p = playlist();
      ImageView art = cover(p.optString("art"), 220);
      LinearLayout.LayoutParams spec = new LinearLayout.LayoutParams(dp(220), dp(220));
      spec.gravity = Gravity.CENTER_HORIZONTAL;
      content.addView(art, spec);
      gap(content, 20);
      content.addView(
          button(
              "Reproduzir",
              true,
              () -> {
                for (JSONObject t : visible())
                  if (playable(t)) {
                    start(t, visible());
                    break;
                  }
              }));
      gap(content, 8);
      content.addView(button("Salvar playlist", false, () -> prepare(visible(), true)));
      gap(content, 8);
      content.addView(button("Editar playlist", false, () -> playlistActions(p)));
      gap(content, 24);
    } else if (tab.equals("Biblioteca")) {
      content.addView(title("Suas playlists", 21));
      gap(content, 14);
      if (playlists().length() == 0)
        content.addView(text("Importe do Spotify ou crie sua primeira playlist.", 15, MUTED));
      for (int i = 0; i < playlists().length(); i += 2) {
        LinearLayout grid = row();
        for (int j = i; j < Math.min(i + 2, playlists().length()); j++) {
          JSONObject p = playlists().optJSONObject(j);
          LinearLayout card = col();
          card.addView(cover(p.optString("art"), 160), new LinearLayout.LayoutParams(-1, dp(160)));
          gap(card, 10);
          card.addView(title(p.optString("name"), 15));
          JSONArray ids = p.optJSONArray("tracks");
          card.addView(text((ids == null ? 0 : ids.length()) + " músicas", 12, MUTED));
          LinearLayout.LayoutParams spec = new LinearLayout.LayoutParams(0, -2, 1);
          spec.setMargins(0, 0, dp(j == i ? 14 : 0), dp(24));
          grid.addView(card, spec);
          card.setOnClickListener(
              v -> {
                selected = p.optString("id");
                render();
              });
          card.setOnLongClickListener(
              v -> {
                playlistActions(p);
                return true;
              });
        }
        content.addView(grid);
      }
      gap(content, 8);
      content.addView(title("Músicas", 22));
      gap(content, 12);
    }
    ArrayList<JSONObject> list = visible();
    for (JSONObject t : list) song(content, t, list);
    if (list.isEmpty())
      content.addView(
          text(
              tab.equals("Baixadas")
                  ? "Suas músicas salvas aparecem aqui, prontas para ouvir sem internet."
                  : "Encontre suas músicas na busca.",
              16,
              MUTED));
    content.setAlpha(.5f);
    content.animate().alpha(1).setDuration(200);
    content.post(() -> visibleImages(content));
  }

  private void song(LinearLayout parent, JSONObject t, ArrayList<JSONObject> list) {
    LinearLayout line = row();
    line.setPadding(0, dp(8), 0, dp(8));
    line.addView(
        cover(t.optString("art", t.optString("thumbnail")), 52),
        new LinearLayout.LayoutParams(dp(52), dp(52)));
    LinearLayout labels = col();
    labels.setPadding(dp(12), 0, dp(6), 0);
    TextView name = title(t.optString("title"), 15);
    name.setMaxLines(1);
    name.setEllipsize(android.text.TextUtils.TruncateAt.END);
    labels.addView(name);
    TextView sub =
        text(
            t.optString("artist", t.optString("artists"))
                + (offline.contains(t.optString("id")) ? " · No aparelho" : ""),
            12,
            MUTED);
    sub.setMaxLines(1);
    sub.setEllipsize(android.text.TextUtils.TruncateAt.END);
    labels.addView(sub);
    line.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
    line.addView(button("•••", false, () -> songActions(t)));
    line.setOnClickListener(v -> start(t, list));
    line.setOnLongClickListener(
        v -> {
          songActions(t);
          return true;
        });
    parent.addView(line);
  }

  interface ValueAction {
    void run(String value);
  }

  private void entry(String title, String hint, ValueAction action) {
    EditText input = field(hint, false);
    LinearLayout box = col();
    box.setPadding(dp(20), dp(10), dp(20), dp(10));
    box.addView(input);
    new AlertDialog.Builder(this)
        .setTitle(title)
        .setView(box)
        .setNegativeButton("Cancelar", null)
        .setPositiveButton(
            "Continuar",
            (a, b) -> {
              String value = input.getText().toString().trim();
              if (!value.isEmpty()) action.run(value);
            })
        .show();
  }

  private void importMenu() {
    new AlertDialog.Builder(this)
        .setTitle("Sua biblioteca")
        .setItems(
            new String[] {"Importar do Spotify", "Criar playlist"},
            (a, i) -> {
              if (i == 0)
                entry(
                    "Importar do Spotify",
                    "Link da playlist, álbum ou música",
                    s -> mutate("import", MusicApi.json("url", s)));
              else
                entry("Nova playlist", "Nome", s -> mutate("playlists", MusicApi.json("name", s)));
            })
        .show();
  }

  private void playlistActions(JSONObject p) {
    new AlertDialog.Builder(this)
        .setTitle(p.optString("name"))
        .setItems(
            new String[] {"Renomear", "Salvar músicas", "Excluir playlist"},
            (a, i) -> {
              if (i == 0)
                entry(
                    "Renomear playlist",
                    "Novo nome",
                    s ->
                        mutate(
                            "playlists/" + p.optString("id") + "/metadata",
                            MusicApi.json("name", s)));
              else if (i == 1) {
                selected = p.optString("id");
                prepare(visible(), true);
              } else mutate("playlists/" + p.optString("id") + "/delete", new JSONObject());
            })
        .show();
  }

  private JSONObject provider(JSONObject t) {
    try {
      JSONObject p = new JSONObject(t.toString());
      p.put("artists", t.optString("artist", t.optString("artists")));
      p.put("thumbnail", t.optString("art", t.optString("thumbnail")));
      return p;
    } catch (Exception e) {
      return t;
    }
  }

  private void songActions(JSONObject t) {
    String id = t.optString("id");
    new AlertDialog.Builder(this)
        .setTitle(t.optString("title"))
        .setItems(
            new String[] {
              "Tocar a seguir",
              "Adicionar ao fim da fila",
              t.optBoolean("liked") ? "Remover das curtidas" : "Curtir",
              "Adicionar à playlist",
              "Salvar no aparelho",
              "Remover download",
              "Excluir da biblioteca"
            },
            (a, i) -> {
              if (i < 2)
                ensure(
                    t,
                    () -> {
                      queue.remove(id);
                      if (i == 0) queue.add(0, id);
                      else queue.add(id);
                      updateQueue();
                      message("Fila atualizada");
                    });
              else if (i == 2)
                ensure(
                    t,
                    () -> mutate("tracks/" + id, MusicApi.json("liked", !t.optBoolean("liked"))));
              else if (i == 3) {
                String[] names = new String[playlists().length()];
                for (int j = 0; j < names.length; j++)
                  names[j] = playlists().optJSONObject(j).optString("name");
                new AlertDialog.Builder(this)
                    .setTitle("Adicionar à playlist")
                    .setItems(
                        names,
                        (x, j) ->
                            mutate(
                                "playlists/"
                                    + playlists().optJSONObject(j).optString("id")
                                    + "/tracks",
                                provider(t)))
                    .show();
              } else if (i == 4) prepare(new ArrayList<>(Collections.singletonList(t)), true);
              else if (i == 5) {
                command("remove", MusicApi.json("id", id));
                offline.remove(id);
                render();
              } else
                new AlertDialog.Builder(this)
                    .setTitle("Excluir música?")
                    .setMessage("Ela será removida da sua biblioteca.")
                    .setNegativeButton("Cancelar", null)
                    .setPositiveButton(
                        "Excluir",
                        (x, y) -> mutate("tracks/" + id, MusicApi.json("action", "delete")))
                    .show();
            })
        .show();
  }

  private boolean playable(JSONObject t) {
    return t != null
        && ("ready".equals(t.optString("status")) || offline.contains(t.optString("id")));
  }

  private void ensure(JSONObject t, Runnable after) {
    if (track(t.optString("id")) != null) {
      after.run();
      return;
    }
    request(
        () -> api.call("tracks", provider(t)),
        r -> {
          JSONArray list = tracks();
          list.put(t);
          try {
            library.put("tracks", list);
          } catch (Exception ignored) {
          }
          after.run();
        },
        this::message);
  }

  private void start(JSONObject t, ArrayList<JSONObject> list) {
    if (t == null) return;
    ensure(
        t,
        () -> {
          if (!playable(t)) {
            prepare(new ArrayList<>(Collections.singletonList(t)), false);
            return;
          }
          if (list != null) {
            context.clear();
            queue.clear();
            boolean after = false;
            for (JSONObject item : list) {
              String id = item.optString("id");
              if (playable(item)) {
                context.add(id);
                if (after) queue.add(id);
              }
              if (id.equals(t.optString("id"))) after = true;
            }
            if (shuffle) Collections.shuffle(queue);
          }
          current = t.optString("id");
          command(
              "start",
              MusicApi.json(
                  "id",
                  current,
                  "queue",
                  new JSONArray(queue),
                  "context",
                  new JSONArray(context),
                  "tracks",
                  tracks(),
                  "repeat",
                  repeat));
          paintMini(t, true);
        });
  }

  private void toggle() {
    if (current.isEmpty()) return;
    command(state.optBoolean("playing") ? "pause" : "play", new JSONObject());
  }

  private void next() {
    if (!queue.isEmpty()) {
      String id = queue.remove(0);
      start(track(id), null);
    }
  }

  private void updateQueue() {
    command(
        "queue",
        MusicApi.json(
            "id",
            current,
            "queue",
            new JSONArray(queue),
            "context",
            new JSONArray(context),
            "tracks",
            tracks(),
            "repeat",
            repeat));
  }

  private void prepare(ArrayList<JSONObject> list, boolean save) {
    JSONArray need = new JSONArray();
    for (JSONObject t : list) {
      String id = t.optString("id");
      if (save) pending.add(id);
      if (!playable(t)) need.put(provider(t));
    }
    if (need.length() > 0)
      request(
          () -> api.call("prepare", MusicApi.json("tracks", need)),
          r -> {
            showActivity("Preparando músicas…");
            refresh(false);
          },
          this::message);
    else drain();
  }

  private void drain() {
    JSONArray ids = new JSONArray();
    for (String id : new HashSet<>(pending)) {
      if (offline.contains(id)) pending.remove(id);
      else if (playable(track(id))) {
        ids.put(id);
        pending.remove(id);
      }
    }
    if (ids.length() > 0) {
      command("download", MusicApi.json("ids", ids, "tracks", tracks()));
      showActivity("Salvando " + ids.length() + " músicas no aparelho");
    }
  }

  private void command(String action, JSONObject payload) {
    if (api.account.isEmpty()) return;
    try {
      payload
          .put("action", action)
          .put("origin", api.origin)
          .put("account", api.account)
          .put("cookie", api.cookie);
      startService(
          new Intent(this, PlaybackService.class)
              .setAction("org.mare.music.COMMAND")
              .putExtra("command", payload.toString()));
    } catch (Exception error) {
      message("Não foi possível iniciar o áudio. Tente novamente.");
    }
  }

  private void adopt(JSONObject value) {
    if (!api.account.equals(value.optString("account"))) return;
    state = value;
    String id = value.optString("id");
    if (!id.isEmpty() && !id.equals("null")) {
      boolean changed = !id.equals(current);
      current = id;
      queue.clear();
      JSONArray q = value.optJSONArray("queue");
      if (q != null) for (int i = 0; i < q.length(); i++) queue.add(q.optString(i));
      JSONObject t = track(id);
      if (t != null) paintMini(t, value.optBoolean("playing"));
      if (changed && player != null && player.isShowing()) {
        player.dismiss();
        openPlayer();
      }
    }
    JSONArray files = value.optJSONArray("offline");
    if (files != null) for (int i = 0; i < files.length(); i++) offline.add(files.optString(i));
    if (player != null && player.isShowing()) {
      playerPlay.setCompoundDrawablesWithIntrinsicBounds(
          new ControlIcon(value.optBoolean("playing") ? "Ⅱ" : "▶", BG), null, null, null);
      if (!scrubbing) {
        long length = value.optLong("duration");
        seek.setProgress(length > 0 ? (int) (value.optLong("position") * 1000 / length) : 0);
        elapsed.setText(time(value.optLong("position")) + "                       " + time(length));
      }
    }
    if (!value.optString("error").isEmpty()) showActivity(value.optString("error"));
  }

  private void paintMini(JSONObject t, boolean playing) {
    if (miniTitle == null) return;
    miniTitle.setText(t.optString("title"));
    miniArtist.setText(t.optString("artist"));
    loadImage(miniCover, t.optString("art"));
    miniPlay.setCompoundDrawablesWithIntrinsicBounds(
        new ControlIcon(playing ? "Ⅱ" : "▶", TEXT), null, null, null);
  }

  private void openPlayer() {
    JSONObject t = track(current);
    if (t == null) return;
    Dialog dialog = new Dialog(this, android.R.style.Theme_Material_NoActionBar);
    player = dialog;
    LinearLayout page = col();
    page.setPadding(dp(28), dp(24), dp(28), dp(28));
    page.setBackground(
        new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] {0xff38232d, BG}));
    page.addView(button("⌄", false, () -> dialog.dismiss()));
    gap(page, 24);
    page.addView(cover(t.optString("art"), 300), new LinearLayout.LayoutParams(-1, dp(290)));
    gap(page, 30);
    page.addView(title(t.optString("title"), 26));
    page.addView(text(t.optString("artist"), 18, MUTED));
    gap(page, 24);
    seek = new SeekBar(this);
    seek.setMax(1000);
    seek.setProgressTintList(android.content.res.ColorStateList.valueOf(PINK));
    seek.setThumbTintList(android.content.res.ColorStateList.valueOf(TEXT));
    page.addView(seek);
    elapsed = text("", 12, MUTED);
    page.addView(elapsed);
    seek.setOnSeekBarChangeListener(
        new SeekBar.OnSeekBarChangeListener() {
          public void onStartTrackingTouch(SeekBar s) {
            scrubbing = true;
          }

          public void onProgressChanged(SeekBar s, int p, boolean user) {}

          public void onStopTrackingTouch(SeekBar s) {
            command(
                "seek",
                MusicApi.json("position", state.optLong("duration") * s.getProgress() / 1000));
            scrubbing = false;
          }
        });
    gap(page, 24);
    LinearLayout controls = row();
    controls.setGravity(Gravity.CENTER);
    controls.addView(button("↤", false, () -> command("seek", MusicApi.json("position", 0))));
    playerPlay = button(state.optBoolean("playing") ? "Ⅱ" : "▶", true, () -> toggle());
    LinearLayout.LayoutParams playSize = new LinearLayout.LayoutParams(dp(76), dp(76));
    playSize.setMargins(dp(24), 0, dp(24), 0);
    controls.addView(playerPlay, playSize);
    controls.addView(button("↦", false, () -> next()));
    page.addView(controls);
    gap(page, 24);
    LinearLayout options = row();
    options.addView(
        button(
            "Aleatório",
            false,
            () -> {
              shuffle = !shuffle;
              if (shuffle) Collections.shuffle(queue);
              updateQueue();
              message(shuffle ? "Aleatório ativado" : "Aleatório desativado");
            }),
        new LinearLayout.LayoutParams(0, -2, 1));
    options.addView(
        button(
            "Repetir",
            false,
            () -> {
              repeat = repeat.equals("off") ? "all" : repeat.equals("all") ? "one" : "off";
              updateQueue();
              message(
                  repeat.equals("one")
                      ? "Repetir faixa"
                      : repeat.equals("all") ? "Repetir playlist" : "Repetição desativada");
            }),
        new LinearLayout.LayoutParams(0, -2, 1));
    page.addView(options);
    gap(page, 12);
    page.addView(button("Fila de reprodução", false, () -> openQueue()));
    page.addView(button("Opções da música", false, () -> songActions(t)));
    ScrollView scroll = new ScrollView(this);
    scroll.addView(page);
    dialog.setContentView(scroll);
    dialog.show();
    dialog.getWindow().setStatusBarColor(0xff38232d);
    dialog.getWindow().setNavigationBarColor(BG);
    page.setAlpha(0);
    page.setTranslationY(dp(40));
    page.animate().alpha(1).translationY(0).setDuration(280);
  }

  private void openQueue() {
    Dialog dialog = new Dialog(this);
    LinearLayout list = col();
    list.setBackground(bg(PANEL, 26));
    list.setPadding(dp(22), dp(24), dp(22), dp(24));
    list.addView(title("A seguir", 26));
    gap(list, 14);
    for (int i = 0; i < queue.size(); i++) {
      int index = i;
      JSONObject t = track(queue.get(i));
      if (t == null) continue;
      LinearLayout item = row();
      TextView name = text(t.optString("title"), 15, TEXT);
      name.setMaxLines(1);
      name.setEllipsize(android.text.TextUtils.TruncateAt.END);
      item.addView(name, new LinearLayout.LayoutParams(0, dp(56), 1));
      item.addView(
          button(
              "↑",
              false,
              () -> {
                if (index > 0) {
                  Collections.swap(queue, index, index - 1);
                  updateQueue();
                  dialog.dismiss();
                  openQueue();
                }
              }));
      name.setOnClickListener(
          v -> {
            String id = queue.get(index);
            queue.subList(0, index + 1).clear();
            start(track(id), null);
            dialog.dismiss();
          });
      list.addView(item);
    }
    if (queue.isEmpty()) list.addView(text("Sua fila está vazia", 16, MUTED));
    ScrollView scroll = new ScrollView(this);
    scroll.addView(list);
    dialog.setContentView(scroll);
    dialog.show();
    dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
    dialog.getWindow().setLayout(-1, -2);
    dialog.getWindow().setGravity(Gravity.BOTTOM);
    list.setTranslationY(dp(60));
    list.animate().translationY(0).setDuration(250);
  }

  private void settings() {
    new AlertDialog.Builder(this)
        .setTitle("Ajustes de música")
        .setItems(
            new String[] {"Atualizar biblioteca", "Retomar preparação", "Sair da conta"},
            (a, i) -> {
              if (i == 0) refresh(true);
              else if (i == 1) mutate("resume", new JSONObject());
              else
                new AlertDialog.Builder(this)
                    .setTitle("Sair da conta?")
                    .setNegativeButton("Cancelar", null)
                    .setPositiveButton(
                        "Sair",
                        (x, y) ->
                            request(
                                () -> api.call("logout", new JSONObject()),
                                r -> {
                                  command("logout", new JSONObject());
                                  api.clear();
                                  library = new JSONObject();
                                  offline.clear();
                                  pending.clear();
                                  queue.clear();
                                  context.clear();
                                  current = "";
                                  content = null;
                                  miniTitle = null;
                                  login();
                                },
                                this::message))
                    .show();
            })
        .show();
  }

  private void showActivity(String value) {
    if (activity != null) {
      activity.setText(value);
      activity.setVisibility(View.VISIBLE);
    }
  }

  private void message(String s) {
    if (!isFinishing()) Toast.makeText(this, s, Toast.LENGTH_LONG).show();
  }

  private void mutate(String path, JSONObject body) {
    request(
        () -> api.call(path, body),
        r -> {
          message("Biblioteca atualizada");
          refresh(true);
        },
        this::message);
  }

  private void refresh(boolean paint) {
    if (refreshing || api.account.isEmpty()) return;
    refreshing = true;
    refreshed = System.currentTimeMillis();
    String owner = api.account;
    request(
        () -> api.call("library", null),
        r -> {
          refreshing = false;
          if (!owner.equals(api.account)) return;
          boolean changed = !library.toString().equals(r.toString());
          library = r;
          getSharedPreferences("library-" + AudioStore.scope(api.origin, owner), 0)
              .edit()
              .putString("cache", r.toString())
              .apply();
          if ((paint || changed) && !tab.equals("Buscar")) render();
          drain();
        },
        error -> {
          refreshing = false;
          if (paint) message(error);
        });
  }

  interface Work {
    JSONObject run() throws Exception;
  }

  interface Success {
    void run(JSONObject result);
  }

  interface Failure {
    void run(String error);
  }

  private void request(Work work, Success success, Failure failure) {
    requests.execute(
        () -> {
          try {
            JSONObject result = work.run();
            main.post(
                () -> {
                  if (!isDestroyed()) success.run(result);
                });
          } catch (Exception error) {
            main.post(
                () -> {
                  if (!isDestroyed())
                    failure.run(
                        error.getMessage() == null
                            ? "Não foi possível conectar."
                            : error.getMessage());
                });
          }
        });
  }

  private ImageView cover(String url, int size) {
    ImageView v = new ImageView(this);
    v.setScaleType(ImageView.ScaleType.CENTER_CROP);
    v.setBackground(bg(PANEL, 14));
    v.setClipToOutline(true);
    v.setMinimumWidth(dp(size));
    v.setImageResource(R.drawable.ic_music);
    loadImage(v, url);
    return v;
  }

  private void loadImage(ImageView view, String url) {
    if (url.isEmpty()) return;
    view.setTag(url);
    if (url.equals(loadedImages.get(view)) || loadingImages.contains(view)) return;
    if (!view.isAttachedToWindow()) {
      view.post(() -> loadImage(view, url));
      return;
    }
    if (!view.getLocalVisibleRect(new Rect())) return;
    view.setTag(url);
    Bitmap cached = covers.get(url);
    if (cached != null) {
      view.setImageBitmap(cached);
      loadedImages.put(view, url);
      return;
    }
    loadingImages.add(view);
    images.execute(
        () -> {
          try {
            if (!url.startsWith("https://")) return;
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(6000);
            c.setInstanceFollowRedirects(false);
            try (InputStream in = c.getInputStream()) {
              ByteArrayOutputStream out = new ByteArrayOutputStream();
              byte[] b = new byte[8192];
              int n;
              while ((n = in.read(b)) != -1) {
                out.write(b, 0, n);
                if (out.size() > 3 * 1024 * 1024) return;
              }
              BitmapFactory.Options options = new BitmapFactory.Options();
              options.inJustDecodeBounds = true;
              byte[] encoded = out.toByteArray();
              BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
              int target = Math.min(900, Math.max(160, view.getMinimumWidth()));
              int sample = 1;
              while (options.outWidth / sample > target * 2
                  || options.outHeight / sample > target * 2) sample *= 2;
              options.inJustDecodeBounds = false;
              options.inSampleSize = sample;
              Bitmap bitmap =
                  BitmapFactory.decodeByteArray(out.toByteArray(), 0, out.size(), options);
              if (bitmap != null) {
                covers.put(url, bitmap);
                main.post(
                    () -> {
                      if (!isDestroyed() && url.equals(view.getTag())) {
                        view.setImageBitmap(bitmap);
                        loadedImages.put(view, url);
                      }
                    });
              }
            } finally {
              c.disconnect();
            }
          } catch (Exception ignored) {
          } finally {
            main.post(() -> loadingImages.remove(view));
          }
        });
  }

  private String time(long ms) {
    long s = Math.max(0, ms / 1000);
    return s / 60 + ":" + String.format(Locale.ROOT, "%02d", s % 60);
  }

  @Override
  public void onBackPressed() {
    if (!selected.isEmpty() || !tab.equals("Biblioteca")) {
      selected = "";
      tab = "Biblioteca";
      render();
    } else super.onBackPressed();
  }

  @Override
  protected void onResume() {
    super.onResume();
    active = true;
    main.removeCallbacks(pulse);
    main.post(pulse);
  }

  @Override
  protected void onPause() {
    active = false;
    main.removeCallbacks(pulse);
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    main.removeCallbacksAndMessages(null);
    requests.shutdownNow();
    images.shutdownNow();
    super.onDestroy();
  }

  private void visibleImages(View view) {
    if (view instanceof ImageView && view.getTag() instanceof String)
      loadImage((ImageView) view, (String) view.getTag());
    else if (view instanceof android.view.ViewGroup) {
      android.view.ViewGroup group = (android.view.ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) visibleImages(group.getChildAt(i));
    }
  }

  private final class ControlIcon extends android.graphics.drawable.Drawable {
    final String kind;
    final Paint pen = new Paint(3);
    final int color;

    ControlIcon(String kind, int color) {
      this.kind = kind;
      this.color = color;
      setBounds(0, 0, dp(22), dp(22));
    }

    public int getIntrinsicWidth() {
      return dp(22);
    }

    public int getIntrinsicHeight() {
      return dp(22);
    }

    public void draw(Canvas canvas) {
      canvas.save();
      canvas.translate(getBounds().left, getBounds().top);
      canvas.scale(getBounds().width() / 24f, getBounds().height() / 24f);
      pen.setColor(color);
      pen.setStrokeWidth(2);
      pen.setStrokeCap(Paint.Cap.ROUND);
      pen.setStyle(Paint.Style.FILL);
      Path p = new Path();
      if (kind.equals("▶") || kind.equals("❯") || kind.equals("↦") || kind.equals("↤")) {
        if (kind.equals("↤")) {
          canvas.translate(24, 0);
          canvas.scale(-1, 1);
        }
        p.moveTo(7, 4);
        p.lineTo(20, 12);
        p.lineTo(7, 20);
        p.close();
        canvas.drawPath(p, pen);
        if (!kind.equals("▶")) canvas.drawRoundRect(20, 4, 22, 20, 1, 1, pen);
      } else if (kind.equals("Ⅱ")) {
        canvas.drawRoundRect(6, 4, 10, 20, 1, 1, pen);
        canvas.drawRoundRect(14, 4, 18, 20, 1, 1, pen);
      } else if (kind.equals("•••")) {
        for (int x = 5; x < 22; x += 7) canvas.drawCircle(x, 12, 1.5f, pen);
      } else {
        pen.setStyle(Paint.Style.STROKE);
        if (kind.equals("＋")) {
          canvas.drawLine(12, 4, 12, 20, pen);
          canvas.drawLine(4, 12, 20, 12, pen);
        } else {
          p.moveTo(5, kind.equals("↑") ? 15 : 8);
          p.lineTo(12, kind.equals("↑") ? 8 : 15);
          p.lineTo(19, kind.equals("↑") ? 15 : 8);
          canvas.drawPath(p, pen);
        }
      }
      canvas.restore();
    }

    public void setAlpha(int a) {}

    public void setColorFilter(ColorFilter f) {}

    public int getOpacity() {
      return PixelFormat.TRANSLUCENT;
    }
  }
}
