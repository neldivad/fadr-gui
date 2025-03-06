document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM Content Loaded");

  // Tab switching
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      tabButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      tabContents.forEach((content) => content.classList.remove("active"));
      document.getElementById(button.getAttribute("data-tab")).classList.add("active");
    });
  });

  // Initialize both tabs separately
  processTab.init();
  recoverTab.init();
});