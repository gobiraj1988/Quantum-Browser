package com.quantum.browser.ai

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Page assistant (like Brave Leo) backed by the Claude Messages API using the user's own key.
 * Only the page text the user explicitly asks about is sent; nothing is sent in the background.
 */
object QuantumAi {

    private const val ENDPOINT = "https://api.anthropic.com/v1/messages"
    private const val MODEL = "claude-haiku-5-5"
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    fun ask(apiKey: String, pageText: String, question: String, callback: (Result<String>) -> Unit) {
        io.execute {
            val result = runCatching { request(apiKey, pageText, question) }
            main.post { callback(result) }
        }
    }

    private fun request(apiKey: String, pageText: String, question: String): String {
        val body = JSONObject()
            .put("model", MODEL)
            .put("max_tokens", 1024)
            .put("system", "You are Quantum AI, a private browsing assistant inside a web browser. " +
                "Answer using the supplied web page. Be concise; use short bullet points for summaries.")
            .put("messages", JSONArray().put(JSONObject()
                .put("role", "user")
                .put("content", "<page>\n$pageText\n</page>\n\n$question")))

        val conn = URL(ENDPOINT).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 20_000; conn.readTimeout = 90_000
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            conn.setRequestProperty("x-api-key", apiKey)
            conn.setRequestProperty("anthropic-version", "2023-06-01")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) {
                val msg = runCatching { JSONObject(text).getJSONObject("error").getString("message") }.getOrDefault(text.take(200))
                error("AI request failed ($code): $msg")
            }
            val content = JSONObject(text).getJSONArray("content")
            val sb = StringBuilder()
            for (i in 0 until content.length()) {
                val block = content.getJSONObject(i)
                if (block.optString("type") == "text") sb.append(block.getString("text"))
            }
            return sb.toString().trim()
        } finally { conn.disconnect() }
    }
}
