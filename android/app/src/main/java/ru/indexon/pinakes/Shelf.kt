package ru.indexon.pinakes

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Environment
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** Полка на телефоне: то же устройство папок, что и на компьютере (Книги/<Автор — Название>/{book.json, cover.*, файлы}). */
class Shelf(private val ctx: Context) {
    val root: File = File(ctx.filesDir, "Книги").also { it.mkdirs() }
    private val tmp = File(ctx.cacheDir, "up").also { it.mkdirs() }

    fun safe(s: String?): String {
        val t = (s ?: "").replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1f]"), " ").replace(Regex("\\s+"), " ").trim().take(110)
        return t.ifEmpty { "Без названия" }
    }
    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
    fun uniqueDir(base: String): File {
        var d = File(root, safe(base)); var n = 2
        while (d.exists()) d = File(root, "${safe(base)} (${n++})")
        return d
    }
    fun dirs(): List<File> = (root.listFiles() ?: emptyArray()).filter { it.isDirectory && !it.name.startsWith(".") && File(it, "book.json").exists() }.sortedBy { it.name }
    fun bookDir(id: String): File? = dirs().firstOrNull { runCatching { JSONObject(File(it, "book.json").readText()).optString("id") == id }.getOrDefault(false) }
    fun read(dir: File): JSONObject = JSONObject(File(dir, "book.json").readText())
    fun write(dir: File, m: JSONObject) { m.remove("dirName"); m.remove("thumb"); File(dir, "book.json").writeText(m.toString(1)) }
    /** книга для интерфейса: к полям book.json добавляем имя папки и наличие миниатюры */
    private fun out(dir: File, m: JSONObject): JSONObject {
        m.put("dirName", dir.name)
        if (m.optString("cover").isNotEmpty()) { val t = thumb(dir, m); if (t != null) m.put("thumb", t.name) }
        return m
    }
    private fun thumb(dir: File, m: JSONObject): File? {
        val cover = m.optString("cover"); if (cover.isEmpty()) return null
        val t = File(dir, "cover-s.jpg"); if (t.exists()) return t
        return runCatching {
            val src = File(dir, cover)
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(src.path, o)
            if (o.outHeight <= 520) return null
            val o2 = BitmapFactory.Options().apply { inSampleSize = Integer.highestOneBit((o.outHeight / 520).coerceAtLeast(1)) }
            val bmp = BitmapFactory.decodeFile(src.path, o2) ?: return null
            val sc = Bitmap.createScaledBitmap(bmp, (bmp.width * 520f / bmp.height).toInt().coerceAtLeast(1), 520, true)
            t.outputStream().use { sc.compress(Bitmap.CompressFormat.JPEG, 86, it) }; t
        }.getOrNull()
    }

    fun list(): JSONArray { val a = JSONArray(); dirs().forEach { d -> runCatching { a.put(out(d, read(d))) } }; return a }

    fun findByHash(h: String): JSONObject? {
        for (d in dirs()) {
            val m = runCatching { read(d) }.getOrNull() ?: continue
            val f = m.optJSONObject("formats") ?: continue; var changed = false
            for (k in f.keys()) {
                val o = f.getJSONObject(k)
                if (!o.has("sha")) { runCatching { o.put("sha", sha(File(d, o.getString("file")).readBytes())); changed = true } }
                if (o.optString("sha") == h) { if (changed) write(d, m); return JSONObject().put("id", m.optString("id")).put("title", m.optString("title")).put("author", m.optString("author")).put("fmt", k) }
            }
            if (changed) write(d, m)
        }
        return null
    }

    // загрузка по частям: JS шлёт base64-куски, потом ссылается на tmp-имя
    fun chunk(id: String, i: Int, b64: String) {
        val f = File(tmp, id.replace(Regex("[^A-Za-z0-9_-]"), "")); if (i == 0) f.delete()
        f.appendBytes(android.util.Base64.decode(b64, android.util.Base64.DEFAULT))
    }
    private fun tmpBytes(id: String): ByteArray { val f = File(tmp, id.replace(Regex("[^A-Za-z0-9_-]"), "")); val b = f.readBytes(); f.delete(); return b }

    private fun putFormat(dir: File, m: JSONObject, ext: String, bytes: ByteArray, title: String, converted: Boolean = false) {
        val file = "${safe(title)}.$ext"; File(dir, file).writeBytes(bytes)
        val f = m.optJSONObject("formats") ?: JSONObject().also { m.put("formats", it) }
        f.put(ext, JSONObject().put("file", file).put("size", bytes.size).put("sha", sha(bytes)).also { if (converted) it.put("converted", true) })
    }
    private fun saveCover(dir: File, m: JSONObject, ext: String, bytes: ByteArray) {
        val name = "cover.$ext"; File(dir, name).writeBytes(bytes); m.put("cover", name); m.put("coverV", System.currentTimeMillis()); File(dir, "cover-s.jpg").delete()
    }

    fun create(a: JSONObject): JSONObject {
        val meta = a.getJSONObject("meta"); val title = meta.optString("title"); val author = meta.optString("author")
        val dir = uniqueDir((if (author.isNotEmpty()) "$author — " else "") + title); dir.mkdirs()
        val m = JSONObject().put("id", java.lang.Long.toHexString((Math.random() * 0xffffffffL).toLong()).padStart(8, '0')).put("title", title).put("author", author)
            .put("lang", meta.optString("lang")).put("pages", meta.optInt("pages")).put("color", meta.optString("color")).put("added", System.currentTimeMillis())
            .put("formats", JSONObject()).put("cover", JSONObject.NULL).put("progress", JSONObject.NULL)
        putFormat(dir, m, a.getString("ext"), tmpBytes(a.getString("tmp")), title)
        a.optJSONObject("cover")?.let { saveCover(dir, m, it.optString("ext", "jpg"), tmpBytes(it.getString("tmp"))) }
        write(dir, m); return out(dir, m)
    }
    fun addFormat(a: JSONObject): JSONObject {
        val dir = bookDir(a.getString("id")) ?: error("Книга не найдена"); val m = read(dir)
        putFormat(dir, m, a.getString("ext"), tmpBytes(a.getString("tmp")), m.optString("title"), a.optBoolean("converted"))
        val cv = a.optJSONObject("cover"); if (m.optString("cover").isEmpty() && cv != null) { saveCover(dir, m, cv.optString("ext", "jpg"), tmpBytes(cv.getString("tmp"))); a.optJSONObject("meta")?.optString("color")?.takeIf { it.isNotEmpty() }?.let { m.put("color", it) } }
        if (m.optInt("pages") == 0) a.optJSONObject("meta")?.optInt("pages")?.takeIf { it > 0 }?.let { m.put("pages", it) }
        write(dir, m); return out(dir, m)
    }
    fun update(id: String, patch: JSONObject): JSONObject {
        val dir = bookDir(id) ?: error("Книга не найдена"); val m = read(dir)
        for (k in listOf("title", "author", "progress", "color", "pages", "lastRead")) if (patch.has(k)) m.put(k, patch.get(k))
        write(dir, m); return out(dir, m)
    }
    private fun toTrash(dir: File) {
        val bin = File(root, ".корзина").also { it.mkdirs() }; var to = File(bin, dir.name); var n = 2
        while (to.exists()) to = File(bin, "${dir.name} (${n++})")
        dir.renameTo(to)
    }
    fun remove(id: String): Boolean { val d = bookDir(id) ?: return false; toTrash(d); return true }
    fun merge(keepId: String, fromId: String): Boolean {
        val dk = bookDir(keepId) ?: error("Книга не найдена"); val df = bookDir(fromId) ?: error("Книга не найдена")
        val mk = read(dk); val mf = read(df); val fk = mk.optJSONObject("formats") ?: JSONObject().also { mk.put("formats", it) }; val ff = mf.optJSONObject("formats") ?: JSONObject()
        for (k in ff.keys()) if (fk.has(k)) error("у обеих книг есть один и тот же формат")
        for (k in ff.keys()) putFormat(dk, mk, k, File(df, ff.getJSONObject(k).getString("file")).readBytes(), mk.optString("title"))
        if (mk.optString("cover").isEmpty() && mf.optString("cover").isNotEmpty()) { saveCover(dk, mk, File(df, mf.getString("cover")).extension, File(df, mf.getString("cover")).readBytes()); mf.optString("color").takeIf { it.isNotEmpty() }?.let { mk.put("color", it) } }
        if (mk.optInt("pages") == 0 && mf.optInt("pages") > 0) mk.put("pages", mf.getInt("pages"))
        if (mk.optString("author").isEmpty() && mf.optString("author").isNotEmpty()) mk.put("author", mf.getString("author"))
        val pf = mf.optJSONObject("progress"); val pk = mk.optJSONObject("progress")
        if (pf != null && (pk == null || pf.optDouble("percent") > pk.optDouble("percent"))) { mk.put("progress", pf); mk.put("lastRead", mf.opt("lastRead")) }
        mk.put("added", minOf(mk.optLong("added", Long.MAX_VALUE), mf.optLong("added", Long.MAX_VALUE)))
        write(dk, mk); toTrash(df); return true
    }

    // ----- выгрузка в «Загрузки/Пинакес» -----
    private fun toDownloads(name: String, bytes: ByteArray): String {
        val mime = when (name.substringAfterLast('.').lowercase()) { "epub" -> "application/epub+zip"; "pdf" -> "application/pdf"; else -> "application/octet-stream" }
        val cv = ContentValues().apply { put(MediaStore.Downloads.DISPLAY_NAME, name); put(MediaStore.Downloads.MIME_TYPE, mime); put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Пинакес") }
        val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv) ?: error("не удалось создать файл")
        ctx.contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }; return name
    }
    fun exportBook(id: String, formats: JSONArray): JSONObject {
        val dir = bookDir(id) ?: error("Книга не найдена"); val m = read(dir); val done = JSONArray()
        for (i in 0 until formats.length()) { val k = formats.getString(i); val f = m.optJSONObject("formats")?.optJSONObject(k) ?: continue
            done.put(toDownloads("${safe((if (m.optString("author").isNotEmpty()) m.optString("author") + " — " else "") + m.optString("title"))}.$k", File(dir, f.getString("file")).readBytes())) }
        return JSONObject().put("dir", "Загрузки/Пинакес").put("files", done)
    }
    fun exportAll(fmt: String): JSONObject {
        var done = 0; var skipped = 0; val failed = JSONArray()
        for (d in dirs()) { val m = read(d); val f = m.optJSONObject("formats")?.optJSONObject(fmt); if (f == null) { skipped++; continue }
            try { toDownloads("${safe((if (m.optString("author").isNotEmpty()) m.optString("author") + " — " else "") + m.optString("title"))}.$fmt", File(d, f.getString("file")).readBytes()); done++ } catch (e: Exception) { failed.put(m.optString("title")) } }
        return JSONObject().put("dir", "Загрузки/Пинакес").put("done", done).put("skipped", skipped).put("failed", failed)
    }
}
