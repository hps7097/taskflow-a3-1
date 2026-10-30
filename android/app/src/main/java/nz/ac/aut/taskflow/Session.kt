package nz.ac.aut.taskflow

import android.content.Context

/** Keeps the sign-in token between app launches (SharedPreferences, private to this app). */
class Session(context: Context) {
    private val prefs = context.getSharedPreferences("taskflow_session", Context.MODE_PRIVATE)

    val token: String? get() = prefs.getString("token", null)
    val displayName: String get() = prefs.getString("display_name", "") ?: ""

    fun save(token: String, user: User) {
        prefs.edit()
            .putString("token", token)
            .putString("display_name", user.displayName)
            .putString("role", user.role)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun api() = ApiClient(token)
}

/** Status values used by the API, with labels for the UI. */
object Statuses {
    val values = listOf("todo", "in-progress", "done")
    val labels = listOf("To do", "In progress", "Done")
    fun label(value: String) = labels.getOrElse(values.indexOf(value)) { value }
}
