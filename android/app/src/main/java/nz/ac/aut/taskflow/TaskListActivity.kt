package nz.ac.aut.taskflow

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import kotlinx.coroutines.launch

/** Screen 2: the tasks the manager has assigned to me. Reloads every time the screen is shown. */
class TaskListActivity : AppCompatActivity() {

    private lateinit var session: Session
    private lateinit var adapter: TaskAdapter
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var errorText: TextView
    private lateinit var emptyText: TextView
    private var loadedOnce = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_task_list)
        session = Session(this)

        swipe = findViewById(R.id.swipe)
        errorText = findViewById(R.id.errorText)
        emptyText = findViewById(R.id.emptyText)
        findViewById<TextView>(R.id.whoText).text = session.displayName

        adapter = TaskAdapter { task ->
            startActivity(Intent(this, TaskDetailActivity::class.java).putExtra(TaskDetailActivity.EXTRA_TASK_ID, task.id))
        }
        val list = findViewById<RecyclerView>(R.id.taskList)
        list.layoutManager = LinearLayoutManager(this)
        list.adapter = adapter

        swipe.setOnRefreshListener { load() }
        findViewById<Button>(R.id.refreshButton).setOnClickListener { load() }
        findViewById<Button>(R.id.signOutButton).setOnClickListener { signOut(null) }
    }

    override fun onResume() {
        super.onResume()
        load() // picks up status changes made on the detail screen, and new assignments
    }

    private fun load() {
        swipe.isRefreshing = true
        lifecycleScope.launch {
            try {
                val tasks = session.api().myTasks()
                adapter.submit(tasks)
                loadedOnce = true
                errorText.visibility = View.GONE
                emptyText.visibility = if (tasks.isEmpty()) View.VISIBLE else View.GONE
            } catch (e: ApiException) {
                if (e.status == 401) {
                    signOut(e.message)
                    return@launch
                }
                // Keep whatever list is already on screen and explain what went wrong.
                val suffix = if (loadedOnce) " Showing the last loaded list." else ""
                errorText.text = (e.message ?: "Something went wrong.") + suffix
                errorText.visibility = View.VISIBLE
            } finally {
                swipe.isRefreshing = false
            }
        }
    }

    private fun signOut(message: String?) {
        session.clear()
        if (message != null) android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show()
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }
}

private class TaskAdapter(private val onClick: (Task) -> Unit) : RecyclerView.Adapter<TaskAdapter.Holder>() {

    private var items: List<Task> = emptyList()

    fun submit(tasks: List<Task>) {
        items = tasks
        notifyDataSetChanged()
    }

    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val title: TextView = view.findViewById(R.id.titleText)
        val project: TextView = view.findViewById(R.id.projectText)
        val status: TextView = view.findViewById(R.id.statusText)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder =
        Holder(LayoutInflater.from(parent.context).inflate(R.layout.item_task, parent, false))

    override fun getItemCount() = items.size

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val task = items[position]
        holder.title.text = task.title
        holder.project.text = task.projectName
        holder.status.text = Statuses.label(task.status)
        holder.itemView.setOnClickListener { onClick(task) }
    }
}
