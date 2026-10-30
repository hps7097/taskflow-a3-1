package nz.ac.aut.taskflow

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * Screen 3: one task. The member can change its status and check in, either with the
 * device location or, when location is refused or unavailable, with a typed place.
 * Both changes appear on the manager's web board straight away (WebSocket on the server).
 */
class TaskDetailActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_TASK_ID = "task_id"
        private const val LOCATION_TIMEOUT_MS = 10_000L
    }

    private lateinit var session: Session
    private var taskId = 0
    private var task: Task? = null

    private lateinit var progress: ProgressBar
    private lateinit var titleText: TextView
    private lateinit var projectText: TextView
    private lateinit var descriptionText: TextView
    private lateinit var messageText: TextView
    private lateinit var statusSpinner: Spinner
    private lateinit var saveButton: Button
    private lateinit var gpsButton: Button
    private lateinit var manualButton: Button
    private lateinit var placeInput: EditText
    private lateinit var checkinsText: TextView

    private val permissionRequest = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results.values.any { it }) {
            checkInWithLocation()
        } else {
            showManualFallback("Location permission was denied. Type where you are and tap \"Check in with typed place\".")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_task_detail)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        session = Session(this)
        taskId = intent.getIntExtra(EXTRA_TASK_ID, 0)

        progress = findViewById(R.id.progress)
        titleText = findViewById(R.id.titleText)
        projectText = findViewById(R.id.projectText)
        descriptionText = findViewById(R.id.descriptionText)
        messageText = findViewById(R.id.messageText)
        statusSpinner = findViewById(R.id.statusSpinner)
        saveButton = findViewById(R.id.saveStatusButton)
        gpsButton = findViewById(R.id.gpsCheckInButton)
        manualButton = findViewById(R.id.manualCheckInButton)
        placeInput = findViewById(R.id.placeInput)
        checkinsText = findViewById(R.id.checkinsText)

        statusSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, Statuses.labels)

        saveButton.setOnClickListener { saveStatus() }
        gpsButton.setOnClickListener { onGpsCheckInClicked() }
        manualButton.setOnClickListener { checkInManual() }

        if (taskId <= 0) {
            showMessage("No task was selected.")
            setBusy(true)
            return
        }
        load(restoreSpinner = savedInstanceState == null)
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    // ---------- loading ----------

    private fun load(restoreSpinner: Boolean = true) {
        setBusy(true)
        lifecycleScope.launch {
            try {
                val (loaded, checkins) = session.api().task(taskId)
                show(loaded, restoreSpinner)
                showCheckins(checkins)
                messageText.visibility = View.GONE
            } catch (e: ApiException) {
                handleError(e)
            } finally {
                setBusy(false)
            }
        }
    }

    private fun show(t: Task, setSpinner: Boolean = true) {
        task = t
        title = t.title
        titleText.text = t.title
        projectText.text = "${t.projectName} · version ${t.version}"
        descriptionText.text = t.description
        descriptionText.visibility = if (t.description.isBlank()) View.GONE else View.VISIBLE
        if (setSpinner) statusSpinner.setSelection(Statuses.values.indexOf(t.status).coerceAtLeast(0))
    }

    private fun showCheckins(checkins: List<Checkin>) {
        checkinsText.text = if (checkins.isEmpty()) {
            getString(R.string.no_checkins)
        } else {
            checkins.take(5).joinToString("\n") { c ->
                val where = if (c.kind == "gps") {
                    String.format("%.5f, %.5f", c.latitude ?: 0.0, c.longitude ?: 0.0)
                } else {
                    "\"${c.place}\" (typed)"
                }
                "• $where — ${c.createdAt} UTC"
            }
        }
    }

    // ---------- status ----------

    private fun saveStatus() {
        val current = task ?: return
        val newStatus = Statuses.values[statusSpinner.selectedItemPosition]
        if (newStatus == current.status) {
            toast("Status is already ${Statuses.label(newStatus)}.")
            return
        }
        setBusy(true)
        lifecycleScope.launch {
            try {
                val updated = session.api().updateStatus(current.id, newStatus, current.version)
                show(updated)
                messageText.visibility = View.GONE
                toast("Saved: ${Statuses.label(updated.status)}")
            } catch (e: ApiException) {
                val latest = e.body?.optJSONObject("task")
                if (e.status == 409 && latest != null) {
                    // Someone else changed the task first: show their version, do not overwrite it.
                    show(ApiClient.parseTask(latest))
                    showMessage("Your manager changed this task first. The latest version is shown; choose the status again if needed.")
                } else {
                    handleError(e)
                }
            } finally {
                setBusy(false)
            }
        }
    }

    // ---------- check-in: location with manual fallback ----------

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun onGpsCheckInClicked() {
        if (hasLocationPermission()) {
            checkInWithLocation()
        } else {
            permissionRequest.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            )
        }
    }

    private fun checkInWithLocation() {
        val current = task ?: return
        setBusy(true)
        showMessage("Getting your location…")
        lifecycleScope.launch {
            try {
                val location = withTimeoutOrNull(LOCATION_TIMEOUT_MS) { currentLocation() }
                if (location == null) {
                    showManualFallback("Could not get a location fix (location may be turned off). Type where you are instead.")
                    return@launch
                }
                session.api().checkInGps(
                    current.id, location.latitude, location.longitude,
                    if (location.hasAccuracy()) location.accuracy else null
                )
                messageText.visibility = View.GONE
                toast("Checked in at %.4f, %.4f".format(location.latitude, location.longitude))
                refreshCheckins()
            } catch (e: ApiException) {
                handleError(e)
            } finally {
                setBusy(false)
            }
        }
    }

    private fun checkInManual() {
        val current = task ?: return
        val place = placeInput.text.toString().trim()
        if (place.isEmpty()) {
            placeInput.error = "Type where you are"
            placeInput.requestFocus()
            return
        }
        setBusy(true)
        lifecycleScope.launch {
            try {
                session.api().checkInManual(current.id, place)
                placeInput.setText("")
                messageText.visibility = View.GONE
                toast("Checked in at \"$place\"")
                refreshCheckins()
            } catch (e: ApiException) {
                handleError(e)
            } finally {
                setBusy(false)
            }
        }
    }

    private suspend fun refreshCheckins() {
        try {
            val (_, checkins) = session.api().task(taskId)
            showCheckins(checkins)
        } catch (e: ApiException) {
            // The check-in itself succeeded; the list will refresh next time.
        }
    }

    /**
     * Android 11+ asks the system for a fresh fix. Older versions use the last known
     * location, which can be stale (listed as a limitation). Returns null if nothing is available.
     */
    @SuppressLint("MissingPermission") // checked by hasLocationPermission() before this is called
    private suspend fun currentLocation(): Location? {
        if (!hasLocationPermission()) return null
        val manager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val provider = when {
            manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> return null
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return suspendCancellableCoroutine { cont ->
                val signal = CancellationSignal()
                cont.invokeOnCancellation { signal.cancel() }
                manager.getCurrentLocation(provider, signal, ContextCompat.getMainExecutor(this)) { location ->
                    if (cont.isActive) cont.resume(location)
                }
            }
        }
        @Suppress("DEPRECATION")
        return manager.getLastKnownLocation(provider)
            ?: manager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
    }

    private fun showManualFallback(message: String) {
        showMessage(message)
        placeInput.requestFocus()
    }

    // ---------- shared UI helpers ----------

    private fun handleError(e: ApiException) {
        if (e.status == 401) {
            session.clear()
            toast(e.message ?: "Please sign in again.")
            startActivity(Intent(this, LoginActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
            finish()
            return
        }
        showMessage(e.message ?: "Something went wrong.")
    }

    private fun showMessage(message: String) {
        messageText.text = message
        messageText.visibility = View.VISIBLE
    }

    private fun setBusy(busy: Boolean) {
        progress.visibility = if (busy) View.VISIBLE else View.GONE
        val enabled = !busy && task != null
        saveButton.isEnabled = enabled
        gpsButton.isEnabled = enabled
        manualButton.isEnabled = enabled
    }

    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
}
