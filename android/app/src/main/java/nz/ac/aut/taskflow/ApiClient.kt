package nz.ac.aut.taskflow

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** A request that reached the server but failed (status 4xx/5xx), or never reached it (status 0). */
class ApiException(val status: Int, message: String, val body: JSONObject? = null) : Exception(message)

data class User(val id: Int, val username: String, val displayName: String, val role: String)

data class Task(
    val id: Int,
    val projectName: String,
    val title: String,
    val description: String,
    val status: String,
    val version: Int,
)

data class Checkin(
    val kind: String,
    val latitude: Double?,
    val longitude: Double?,
    val place: String?,
    val userName: String,
    val createdAt: String,
)

/**
 * Talks to the TaskFlow REST API with HttpURLConnection (no extra libraries).
 * Every call runs on the IO dispatcher and returns parsed objects or throws ApiException.
 */
class ApiClient(private val token: String?) {

    private val baseUrl = BuildConfig.BASE_URL

    suspend fun login(username: String, password: String): Pair<String, User> {
        val body = JSONObject().put("username", username).put("password", password)
        val json = request("POST", "/api/login", body) as JSONObject
        return json.getString("token") to parseUser(json.getJSONObject("user"))
    }

    suspend fun myTasks(): List<Task> {
        val arr = request("GET", "/api/my/tasks") as JSONArray
        return (0 until arr.length()).map { parseTask(arr.getJSONObject(it)) }
    }

    suspend fun task(id: Int): Pair<Task, List<Checkin>> {
        val json = request("GET", "/api/tasks/$id") as JSONObject
        val arr = json.optJSONArray("checkins") ?: JSONArray()
        val checkins = (0 until arr.length()).map { parseCheckin(arr.getJSONObject(it)) }
        return parseTask(json) to checkins
    }

    suspend fun updateStatus(id: Int, status: String, expectedVersion: Int): Task {
        val body = JSONObject().put("status", status).put("expectedVersion", expectedVersion)
        return parseTask(request("PUT", "/api/tasks/$id", body) as JSONObject)
    }

    suspend fun checkInGps(id: Int, latitude: Double, longitude: Double, accuracy: Float?): Checkin {
        val body = JSONObject().put("latitude", latitude).put("longitude", longitude)
        if (accuracy != null) body.put("accuracy", accuracy.toDouble())
        return parseCheckin(request("POST", "/api/tasks/$id/checkins", body) as JSONObject)
    }

    suspend fun checkInManual(id: Int, place: String): Checkin {
        val body = JSONObject().put("place", place)
        return parseCheckin(request("POST", "/api/tasks/$id/checkins", body) as JSONObject)
    }

    private suspend fun request(method: String, path: String, body: JSONObject? = null): Any =
        withContext(Dispatchers.IO) {
            val conn = (URL(baseUrl + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 5000
                readTimeout = 8000
                setRequestProperty("Accept", "application/json")
                if (token != null) setRequestProperty("Authorization", "Bearer $token")
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }
            try {
                if (body != null) conn.outputStream.use { it.write(body.toString().toByteArray()) }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
                if (code !in 200..299) {
                    val err = try { JSONObject(text) } catch (e: Exception) { null }
                    val message = err?.optString("error")?.takeIf { it.isNotBlank() } ?: "Request failed (HTTP $code)"
                    throw ApiException(code, message, err)
                }
                when {
                    text.isBlank() -> JSONObject()
                    text.trimStart().startsWith("[") -> JSONArray(text)
                    else -> JSONObject(text)
                }
            } catch (e: IOException) {
                throw ApiException(0, "Cannot reach the server at $baseUrl. Check that the API is running and try again.")
            } catch (e: org.json.JSONException) {
                throw ApiException(0, "The server sent a response the app could not read.")
            } finally {
                conn.disconnect()
            }
        }

    companion object {
        fun parseUser(o: JSONObject) = User(
            id = o.getInt("id"),
            username = o.getString("username"),
            displayName = o.getString("display_name"),
            role = o.getString("role"),
        )

        fun parseTask(o: JSONObject) = Task(
            id = o.getInt("id"),
            projectName = o.optString("project_name", ""),
            title = o.getString("title"),
            description = o.optString("description", ""),
            status = o.getString("status"),
            version = o.optInt("version", 1),
        )

        fun parseCheckin(o: JSONObject) = Checkin(
            kind = o.getString("kind"),
            latitude = if (o.isNull("latitude")) null else o.getDouble("latitude"),
            longitude = if (o.isNull("longitude")) null else o.getDouble("longitude"),
            place = if (o.isNull("place")) null else o.getString("place"),
            userName = o.optString("user_name", ""),
            createdAt = o.optString("created_at", ""),
        )
    }
}
