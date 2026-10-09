package ru.indexon.pinakes

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream

/** Пинакес для Android: тот же интерфейс, что на компьютере, в WebView; вместо Electron — мост к файлам полки. */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var shelf: Shelf
    private val picked = HashMap<Int, Uri>()
    private var pickSeq = 0
    private var pickReq = ""

    private val picker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val paths = JSONArray()
        val data = r.data
        if (r.resultCode == RESULT_OK && data != null) {
            val uris = ArrayList<Uri>()
            data.clipData?.let { c -> for (i in 0 until c.itemCount) uris.add(c.getItemAt(i).uri) } ?: data.data?.let { uris.add(it) }
            for (u in uris) {
                val n = ++pickSeq; picked[n] = u
                var name = "book"
                contentResolver.query(u, null, null, null, null)?.use { c -> if (c.moveToFirst()) { val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME); if (i >= 0) name = c.getString(i) } }
                paths.put("picked/$n/$name")
            }
        }
        web.evaluateJavascript("window.__pickDone(${JSONObject.quote(pickReq)}, ${paths})", null)
    }

    inner class Bridge {
        @JavascriptInterface
        fun call(name: String, args: String): String = try {
            JSONObject().put("result", run(name, JSONObject(if (args.isEmpty()) "{}" else args))).toString()
        } catch (e: Throwable) { JSONObject().put("error", e.message ?: e.toString()).toString() }

        @JavascriptInterface
        fun pick(req: String) { runOnUiThread {
            pickReq = req
            picker.launch(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"; putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/epub+zip", "application/pdf", "application/x-fictionbook+xml", "application/zip", "text/xml", "application/octet-stream"))
            })
        } }

        private fun run(name: String, a: JSONObject): Any? = when (name) {
            "list" -> shelf.list()
            "findByHash" -> shelf.findByHash(a.getString("sha")) ?: JSONObject.NULL
            "chunk" -> { shelf.chunk(a.getString("id"), a.getInt("i"), a.getString("b64")); true }
            "create" -> shelf.create(a)
            "addFormat" -> shelf.addFormat(a)
            "update" -> shelf.update(a.getString("id"), a.getJSONObject("patch"))
            "remove" -> shelf.remove(a.getString("id"))
            "merge" -> shelf.merge(a.getString("keepId"), a.getString("fromId"))
            "exportBook" -> shelf.exportBook(a.getString("id"), a.getJSONArray("formats"))
            "exportAll" -> shelf.exportAll(a.getString("fmt"))
            else -> error("неизвестный вызов $name")
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        shelf = Shelf(this)
        val loader = WebViewAssetLoader.Builder().setDomain("appassets.androidplatform.net")
            .addPathHandler("/www/") { p -> // интерфейс из assets/www
                try { WebResourceResponse(mime(p), "utf-8", assets.open("www/" + Uri.decode(p))) } catch (e: Exception) { null }
            }
            .addPathHandler("/shelf/") { p -> // файлы полки: обложки и книги
                val f = File(shelf.root, Uri.decode(p)); if (!f.canonicalPath.startsWith(shelf.root.canonicalPath) || !f.isFile) null
                else WebResourceResponse(mime(f.name), null, FileInputStream(f))
            }
            .addPathHandler("/picked/") { p -> // выбранные в системном окне файлы
                val n = p.substringBefore('/').toIntOrNull(); val u = n?.let { picked[it] }
                if (u == null) null else WebResourceResponse("application/octet-stream", null, contentResolver.openInputStream(u))
            }.build()
        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(0xFF0D0906.toInt())
            settings.apply { javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false; mediaPlaybackRequiresUserGesture = false; mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; textZoom = 100 }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(r.url)
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest) = !r.url.host.equals("appassets.androidplatform.net")
            }
            addJavascriptInterface(Bridge(), "AndroidBridge")
        }
        setContentView(web)
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, true)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.__back && window.__back()") { r -> if (r != "true") { isEnabled = false; onBackPressedDispatcher.onBackPressed() } }
            }
        })
        web.loadUrl("https://appassets.androidplatform.net/www/index.html")
    }

    private fun mime(n: String) = when (n.substringAfterLast('.').lowercase()) {
        "jpg", "jpeg" -> "image/jpeg"; "png" -> "image/png"; "gif" -> "image/gif"; "webp" -> "image/webp"
        "epub" -> "application/epub+zip"; "pdf" -> "application/pdf"; "fb2" -> "application/xml"
        "html" -> "text/html"; "js" -> "text/javascript"; "css" -> "text/css"; "json" -> "application/json"; "woff2" -> "font/woff2"; "woff" -> "font/woff"; "svg" -> "image/svg+xml"; "map" -> "application/json"
        else -> "application/octet-stream"
    }
}
