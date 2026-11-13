package org.mare.music;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Set;
import org.json.JSONObject;

@androidx.media3.common.util.UnstableApi
public final class MainActivity extends Activity {
  private WebView web;
  private String origin;
  private final Handler handler = new Handler();
  private boolean resumed;
  private final Runnable tick =
      new Runnable() {
        public void run() {
          if (web != null && resumed && ServerAddress.sameOrigin(origin, web.getUrl())) {
            JSONObject state = PlaybackService.snapshot(MainActivity.this);
            web.evaluateJavascript("window.receiveMareNativeState?.(" + state + ")", null);
          }
          if (resumed) handler.postDelayed(this, 700);
        }
      };

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    if (android.os.Build.VERSION.SDK_INT >= 33
        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED)
      requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 1);
    origin = getPreferences(MODE_PRIVATE).getString("origin", "");
    if (origin.isEmpty()) chooseServer();
    else openServer();
  }

  private void chooseServer() {
    LinearLayout panel = new LinearLayout(this);
    panel.setOrientation(LinearLayout.VERTICAL);
    panel.setPadding(28, 64, 28, 28);
    panel.setBackgroundColor(Color.rgb(16, 16, 20));
    TextView title = new TextView(this);
    title.setText("Maré Música");
    title.setTextSize(30);
    title.setTextColor(Color.WHITE);
    panel.addView(title);
    TextView hint = new TextView(this);
    hint.setText("Entre no mesmo servidor do seu celular e PC. Depois, use sua conta Maré.");
    hint.setTextColor(Color.LTGRAY);
    hint.setPadding(0, 20, 0, 20);
    panel.addView(hint);
    EditText address = new EditText(this);
    address.setSingleLine(true);
    address.setTextColor(Color.WHITE);
    address.setHintTextColor(Color.GRAY);
    address.setHint("https://seu-servidor.example");
    address.setInputType(17);
    panel.addView(address);
    Button enter = new Button(this);
    enter.setText("Continuar");
    panel.addView(enter);
    enter.setOnClickListener(
        v -> {
          try {
            origin = ServerAddress.normalize(address.getText().toString());
            getPreferences(MODE_PRIVATE).edit().putString("origin", origin).apply();
            openServer();
          } catch (RuntimeException error) {
            address.setError("Use o endereço HTTPS completo do seu servidor.");
          }
        });
    setContentView(panel);
  }

  @SuppressWarnings("SetJavaScriptEnabled")
  private void openServer() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      new AlertDialog.Builder(this)
          .setMessage("Atualize o Android System WebView para usar o player nativo.")
          .setPositiveButton("OK", (d, w) -> finish())
          .show();
      return;
    }
    web = new WebView(this);
    web.setBackgroundColor(Color.rgb(16, 16, 20));
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setMediaPlaybackRequiresUserGesture(true);
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
    web.setWebViewClient(
        new WebViewClient() {
          @Override
          public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (ServerAddress.sameOrigin(origin, request.getUrl().toString())) return false;
            if (request.isForMainFrame() && "https".equals(request.getUrl().getScheme())) {
              try {
                startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
              } catch (RuntimeException ignored) {
              }
            }
            return true;
          }

          @Override
          public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
          }
        });
    WebViewCompat.addWebMessageListener(
        web,
        "MareNative",
        Set.of(origin),
        (view, message, sourceOrigin, mainFrame, reply) -> {
          if (!mainFrame || !ServerAddress.sameOrigin(origin, sourceOrigin.toString())) return;
          String raw = message.getData();
          if (raw == null || raw.length() > 2_000_000) return;
          try {
            JSONObject command = new JSONObject(raw);
            command.put("origin", origin);
            // HttpOnly credentials never cross the JavaScript bridge.
            command.put("cookie", CookieManager.getInstance().getCookie(origin));
            startService(
                new Intent(this, PlaybackService.class)
                    .setAction("org.mare.music.COMMAND")
                    .putExtra("command", command.toString()));
          } catch (Exception error) {
            Toast.makeText(
                    this, "Não foi possível executar o comando de áudio.", Toast.LENGTH_SHORT)
                .show();
          }
        });
    setContentView(web);
    web.setOnApplyWindowInsetsListener(
        (v, insets) -> {
          v.setPadding(
              insets.getSystemWindowInsetLeft(),
              insets.getSystemWindowInsetTop(),
              insets.getSystemWindowInsetRight(),
              insets.getSystemWindowInsetBottom());
          return insets.consumeSystemWindowInsets();
        });
    web.loadUrl(origin + "/");
  }

  @Override
  public void onBackPressed() {
    if (web != null) web.evaluateJavascript("history.back()", null);
    else super.onBackPressed();
  }

  @Override
  protected void onResume() {
    super.onResume();
    resumed = true;
    handler.removeCallbacks(tick);
    handler.post(tick);
  }

  @Override
  protected void onPause() {
    resumed = false;
    handler.removeCallbacks(tick);
    CookieManager.getInstance().flush();
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacks(tick);
    if (web != null) {
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }
}
