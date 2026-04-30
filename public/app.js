const boardElement = document.getElementById("board");
const columnForm = document.getElementById("column-form");
const columnTitleInput = document.getElementById("column-title");
const taskFormTemplate = document.getElementById("task-form-template");
const welcomeMessage = document.getElementById("welcome-message");
const logoutButton = document.getElementById("logout-button");
const boardFeedback = document.getElementById("board-feedback");
// Store the task currently being dragged so drop zones know what to move.
let draggedTask = null;

// Small helper so every API call handles JSON the same way.
async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong");
  }

  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showBoardFeedback(message, type = "error") {
  boardFeedback.textContent = message;
  boardFeedback.className = `feedback-message ${type}`;
}

function clearBoardFeedback() {
  boardFeedback.textContent = "";
  boardFeedback.className = "feedback-message hidden";
}

async function moveTask(taskId, fromColumnId, toColumnId) {
  if (!toColumnId || fromColumnId === toColumnId) {
    return;
  }

  // Both the dropdown and drag-and-drop use the same backend route.
  await request("/api/tasks/move", {
    method: "PATCH",
    body: JSON.stringify({
      taskId,
      fromColumnId,
      toColumnId
    })
  });

  await loadBoard();
}

function blockTextInputDrop(element) {
  // Prevent dragged task text from being inserted into form fields.
  ["dragover", "drop"].forEach((eventName) => {
    element.addEventListener(eventName, (event) => {
      if (!draggedTask) {
        return;
      }

      event.preventDefault();
    });
  });
}

function createTaskCard(columnId, task, columns) {
  const card = document.createElement("article");
  card.className = "task-card";
  card.draggable = true;
  card.dataset.taskId = task.id;
  card.dataset.columnId = columnId;

  const moveOptions = columns
    .filter((column) => column.id !== columnId)
    .map((column) => `<option value="${column.id}">Move to ${column.title}</option>`)
    .join("");

  card.innerHTML = `
    <div class="task-copy">
      <h3>${escapeHtml(task.title)}</h3>
      <p>${escapeHtml(task.description || "No description yet.")}</p>
    </div>
    <form class="edit-task-form hidden">
      <input name="title" type="text" value="${escapeHtml(task.title)}" maxlength="80" required />
      <textarea name="description" rows="3" placeholder="Short description" maxlength="400">${escapeHtml(task.description || "")}</textarea>
      <div class="edit-actions">
        <button type="submit">Save</button>
        <button class="secondary-button cancel-edit-button" type="button">Cancel</button>
      </div>
    </form>
    <div class="task-actions">
      <button class="secondary-button edit-button" type="button">Edit</button>
      <select class="move-select">
        <option value="">Move task...</option>
        ${moveOptions}
      </select>
      <button class="delete-button" type="button">Delete</button>
    </div>
  `;

  const taskCopy = card.querySelector(".task-copy");
  const editForm = card.querySelector(".edit-task-form");
  const editButton = card.querySelector(".edit-button");
  const cancelEditButton = card.querySelector(".cancel-edit-button");
  const moveSelect = card.querySelector(".move-select");
  const deleteButton = card.querySelector(".delete-button");

  editForm.querySelectorAll("input, textarea").forEach(blockTextInputDrop);

  // The browser only knows raw drag events, so we keep the task details ourselves.
  card.addEventListener("dragstart", (event) => {
    draggedTask = {
      taskId: task.id,
      fromColumnId: columnId
    };
    card.classList.add("task-card-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
  });

  card.addEventListener("dragend", () => {
    draggedTask = null;
    card.classList.remove("task-card-dragging");
    document.querySelectorAll(".task-list-drop-target").forEach((element) => {
      element.classList.remove("task-list-drop-target");
    });
  });

  // Swap the task card into edit mode without leaving the page.
  editButton.addEventListener("click", () => {
    taskCopy.classList.add("hidden");
    editForm.classList.remove("hidden");
  });

  cancelEditButton.addEventListener("click", () => {
    editForm.reset();
    taskCopy.classList.remove("hidden");
    editForm.classList.add("hidden");
  });

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(editForm);

    try {
      clearBoardFeedback();
      await request(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: formData.get("title"),
          description: formData.get("description")
        })
      });

      await loadBoard();
    } catch (error) {
      showBoardFeedback(error.message);
    }
  });

  moveSelect.addEventListener("change", async (event) => {
    const toColumnId = event.target.value;

    if (!toColumnId) {
      return;
    }

    try {
      clearBoardFeedback();
      await moveTask(task.id, columnId, toColumnId);
    } catch (error) {
      showBoardFeedback(error.message);
    } finally {
      moveSelect.value = "";
    }
  });

  deleteButton.addEventListener("click", async () => {
    try {
      clearBoardFeedback();
      await request(`/api/tasks/${task.id}`, {
        method: "DELETE"
      });

      await loadBoard();
    } catch (error) {
      showBoardFeedback(error.message);
    }
  });

  return card;
}

function createTaskForm(columnId) {
  const form = taskFormTemplate.content.firstElementChild.cloneNode(true);
  form.querySelectorAll("input, textarea").forEach(blockTextInputDrop);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);

    try {
      clearBoardFeedback();
      await request("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          columnId,
          title: formData.get("title"),
          description: formData.get("description")
        })
      });

      form.reset();
      await loadBoard();
    } catch (error) {
      showBoardFeedback(error.message);
    }
  });

  return form;
}

function createColumnHeader(column) {
  const header = document.createElement("div");
  header.className = "column-header";
  header.innerHTML = `
    <div class="column-title-wrap">
      <div class="column-title-row">
        <h2>${column.title}</h2>
        <button class="secondary-button rename-column-button" type="button">Rename</button>
        <button class="delete-button remove-column-button" type="button">Remove</button>
      </div>
      <form class="rename-column-form hidden">
        <input name="title" type="text" value="${escapeHtml(column.title)}" maxlength="40" required />
        <div class="edit-actions">
          <button type="submit">Save</button>
          <button class="secondary-button cancel-rename-button" type="button">Cancel</button>
        </div>
      </form>
    </div>
    <span>${column.tasks.length} task${column.tasks.length === 1 ? "" : "s"}</span>
  `;

  const titleRow = header.querySelector(".column-title-row");
  const renameButton = header.querySelector(".rename-column-button");
  const renameForm = header.querySelector(".rename-column-form");
  const cancelRenameButton = header.querySelector(".cancel-rename-button");
  const removeColumnButton = header.querySelector(".remove-column-button");

  renameForm.querySelectorAll("input").forEach(blockTextInputDrop);

  renameButton.addEventListener("click", () => {
    titleRow.classList.add("hidden");
    renameForm.classList.remove("hidden");
  });

  cancelRenameButton.addEventListener("click", () => {
    renameForm.reset();
    renameForm.classList.add("hidden");
    titleRow.classList.remove("hidden");
  });

  renameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(renameForm);

    try {
      clearBoardFeedback();
      await request(`/api/columns/${column.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: formData.get("title")
        })
      });

      await loadBoard();
    } catch (error) {
      showBoardFeedback(error.message);
    }
  });

  removeColumnButton.addEventListener("click", async () => {
    const shouldRemove = window.confirm(`Remove "${column.title}" and all tasks inside it?`);

    if (!shouldRemove) {
      return;
    }

    try {
      clearBoardFeedback();
      await request(`/api/columns/${column.id}`, {
        method: "DELETE"
      });

      await loadBoard();
    } catch (error) {
      showBoardFeedback(error.message);
    }
  });

  return header;
}

function enableColumnDrop(taskList, columnId) {
  // Prevent the browser's default behavior so this column can accept a drop.
  taskList.addEventListener("dragover", (event) => {
    if (!draggedTask || draggedTask.fromColumnId === columnId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    taskList.classList.add("task-list-drop-target");
  });

  taskList.addEventListener("dragleave", (event) => {
    if (!taskList.contains(event.relatedTarget)) {
      taskList.classList.remove("task-list-drop-target");
    }
  });

  taskList.addEventListener("drop", async (event) => {
    event.preventDefault();
    taskList.classList.remove("task-list-drop-target");

    if (!draggedTask) {
      return;
    }

    try {
      clearBoardFeedback();
      await moveTask(draggedTask.taskId, draggedTask.fromColumnId, columnId);
    } catch (error) {
      showBoardFeedback(error.message);
    }
  });
}

// Rebuild the board UI from the latest server data after each change.
function renderBoard(board) {
  boardElement.innerHTML = "";
  clearBoardFeedback();

  board.columns.forEach((column) => {
    const section = document.createElement("section");
    section.className = "column";
    section.appendChild(createColumnHeader(column));

    section.appendChild(createTaskForm(column.id));

    const taskList = document.createElement("div");
    taskList.className = "task-list";
    enableColumnDrop(taskList, column.id);

    column.tasks.forEach((task) => {
      taskList.appendChild(createTaskCard(column.id, task, board.columns));
    });

    section.appendChild(taskList);
    boardElement.appendChild(section);
  });
}

async function loadBoard() {
  try {
    const board = await request("/api/board");
    renderBoard(board);
  } catch (error) {
    if (error.message === "Please log in first." || error.message === "Not logged in.") {
      window.location.href = "/login";
      return;
    }

    showBoardFeedback(error.message);
    boardElement.innerHTML = "";
  }
}

async function loadSession() {
  const session = await request("/api/session");
  welcomeMessage.textContent = `Signed in as ${session.user.name}`;
}

logoutButton.addEventListener("click", async () => {
  try {
    // Logging out clears the session on the server before we send the user back.
    await request("/api/logout", {
      method: "POST",
      body: JSON.stringify({})
    });
  } finally {
    window.location.href = "/login";
  }
});

columnForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    clearBoardFeedback();
    await request("/api/columns", {
      method: "POST",
      body: JSON.stringify({
        title: columnTitleInput.value
      })
    });

    columnForm.reset();
    await loadBoard();
  } catch (error) {
    showBoardFeedback(error.message);
  }
});

async function startApp() {
  try {
    // Load the current user first so the board page can show who is signed in.
    await loadSession();
    await loadBoard();
  } catch (error) {
    window.location.href = "/login";
  }
}

columnForm.querySelectorAll("input").forEach(blockTextInputDrop);
startApp();
