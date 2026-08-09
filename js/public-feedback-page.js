import { insertWithOptionalColumns, number } from "./supabase.js?v=20260809-formal-client-feedback-v159";

const params = new URLSearchParams(window.location.search);
const projectId = params.get("project_id");
const projectServiceParam = params.get("project") || params.get("service") || params.get("title") || "";
const publicFeedbackForm = document.getElementById("publicFeedbackForm");
const clientNameField = document.getElementById("client_name");
const projectServiceField = document.getElementById("project_service");
const feedbackDateField = document.getElementById("feedback_date");
const commentsField = document.getElementById("comments");
const recommendationsField = document.getElementById("recommendations");
const qrReference = document.getElementById("qrReference");
const submitButton = publicFeedbackForm.querySelector("button[type='submit']");

if (feedbackDateField) {
  feedbackDateField.value = new Date().toISOString().split("T")[0];
}

if (projectServiceField && projectServiceParam) {
  projectServiceField.value = projectServiceParam;
}

if (qrReference) {
  const todayCode = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  qrReference.textContent = projectId ? `FS-QR-${todayCode}-${String(projectId).slice(0, 8)}` : `FS-QR-${todayCode}`;
}

publicFeedbackForm.addEventListener("submit", async function(e) {
  e.preventDefault();

  const selectedRating = publicFeedbackForm.querySelector("input[name='rating']:checked");
  const ratingValue = number(selectedRating?.value);

  if (!projectId) {
    alert("Missing project reference. Please scan the project feedback QR code again.");
    return;
  }

  if (ratingValue < 1 || ratingValue > 5) {
    alert("Please enter a rating from 1 to 5.");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";

  const { error } = await insertWithOptionalColumns("feedback", {
    project_id: projectId,
    client_name: clientNameField.value.trim(),
    project_service: projectServiceField.value.trim(),
    rating: ratingValue,
    overall_satisfaction: ratingValue,
    comments: commentsField.value.trim(),
    recommendations: recommendationsField.value.trim(),
    date: feedbackDateField.value || new Date().toISOString().split("T")[0]
  }, ["project_service", "rating", "overall_satisfaction", "recommendations", "date"]);

  submitButton.disabled = false;
  submitButton.textContent = "Submit Feedback";

  if (error) {
    alert("Error submitting feedback: " + error.message);
    return;
  }

  alert("Thank you! Your feedback has been submitted.");
  publicFeedbackForm.reset();
  if (feedbackDateField) feedbackDateField.value = new Date().toISOString().split("T")[0];
  if (projectServiceField && projectServiceParam) projectServiceField.value = projectServiceParam;
});
