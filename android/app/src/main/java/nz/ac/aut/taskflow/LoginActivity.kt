package nz.ac.aut.taskflow

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/** Screen 1: sign in as a team member. */
class LoginActivity : AppCompatActivity() {

    private lateinit var session: Session

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        session = Session(this)

        // Already signed in: go straight to the task list (the list re-checks the token).
        if (session.token != null) {
            openTasks()
            return
        }

        setContentView(R.layout.activity_login)
        val username = findViewById<EditText>(R.id.usernameInput)
        val password = findViewById<EditText>(R.id.passwordInput)
        val button = findViewById<Button>(R.id.signInButton)
        val progress = findViewById<ProgressBar>(R.id.progress)
        val error = findViewById<TextView>(R.id.errorText)
        findViewById<TextView>(R.id.serverText).text = getString(R.string.server_hint, BuildConfig.BASE_URL)

        button.setOnClickListener {
            val user = username.text.toString().trim()
            val pass = password.text.toString()
            if (user.isEmpty() || pass.isEmpty()) {
                error.text = "Enter your username and password."
                error.visibility = View.VISIBLE
                return@setOnClickListener
            }
            error.visibility = View.GONE
            progress.visibility = View.VISIBLE
            button.isEnabled = false

            lifecycleScope.launch {
                try {
                    val (token, signedIn) = ApiClient(null).login(user, pass)
                    if (signedIn.role != "member") {
                        error.text = "This app is for team members. Managers use the web board."
                        error.visibility = View.VISIBLE
                    } else {
                        session.save(token, signedIn)
                        openTasks()
                    }
                } catch (e: ApiException) {
                    error.text = e.message
                    error.visibility = View.VISIBLE
                } finally {
                    progress.visibility = View.GONE
                    button.isEnabled = true
                }
            }
        }
    }

    private fun openTasks() {
        startActivity(Intent(this, TaskListActivity::class.java))
        finish()
    }
}
