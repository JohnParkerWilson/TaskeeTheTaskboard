const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const showLoginButton = document.getElementById("show-login");
const showRegisterButton = document.getElementById("show-register");
const authError = document.getElementById("auth-error");

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

function setMode(mode) {
  const loginMode = mode === "login";

  loginForm.classList.toggle("hidden", !loginMode);
  registerForm.classList.toggle("hidden", loginMode);
  showLoginButton.classList.toggle("active-tab", loginMode);
  showRegisterButton.classList.toggle("active-tab", !loginMode);
  authError.classList.add("hidden");
  authError.textContent = "";
}

function showError(message) {
  authError.textContent = message;
  authError.classList.remove("hidden");
}

showLoginButton.addEventListener("click", () => setMode("login"));
showRegisterButton.addEventListener("click", () => setMode("register"));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);

  try {
    await request("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password")
      })
    });

    window.location.href = "/";
  } catch (error) {
    showError(error.message);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(registerForm);

  try {
    await request("/api/register", {
      method: "POST",
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password")
      })
    });

    window.location.href = "/";
  } catch (error) {
    showError(error.message);
  }
});
