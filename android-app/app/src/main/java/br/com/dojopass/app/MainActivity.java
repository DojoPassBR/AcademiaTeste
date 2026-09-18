package br.com.dojopass.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://dojopass.com.br/AcademiaTeste/app/login.html?app=android";
    private static final int RED = Color.rgb(224, 16, 25);
    private static final int BLACK = Color.rgb(8, 9, 13);

    private WebView webView;
    private LinearLayout splash;
    private TextView loadingText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BLACK);
        getWindow().setNavigationBarColor(BLACK);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        splash = buildSplash();
        root.addView(splash, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);
        configureWebView();
        webView.loadUrl(APP_URL);
    }

    private LinearLayout buildSplash() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(dp(28), dp(28), dp(28), dp(28));
        layout.setBackgroundColor(BLACK);

        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.ic_dojopass_mark);
        LinearLayout.LayoutParams markParams = new LinearLayout.LayoutParams(dp(116), dp(116));
        markParams.bottomMargin = dp(22);
        layout.addView(mark, markParams);

        TextView title = new TextView(this);
        title.setText(R.string.splash_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(34);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        layout.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText(R.string.splash_subtitle);
        subtitle.setTextColor(Color.rgb(214, 218, 226));
        subtitle.setTextSize(15);
        subtitle.setLetterSpacing(0.08f);
        subtitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subtitleParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        subtitleParams.topMargin = dp(6);
        layout.addView(subtitle, subtitleParams);

        ProgressBar progress = new ProgressBar(this);
        progress.getIndeterminateDrawable().setTint(RED);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(46), dp(46));
        progressParams.topMargin = dp(34);
        layout.addView(progress, progressParams);

        loadingText = new TextView(this);
        loadingText.setText(R.string.splash_loading);
        loadingText.setTextColor(Color.rgb(176, 182, 194));
        loadingText.setTextSize(14);
        loadingText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams loadingParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        loadingParams.topMargin = dp(14);
        layout.addView(loadingText, loadingParams);

        return layout;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) {
                    return false;
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                splash.animate()
                        .alpha(0f)
                        .setDuration(260)
                        .withEndAction(() -> splash.setVisibility(View.GONE))
                        .start();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                    }, 10);
                }
                callback.invoke(origin, true, false);
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
