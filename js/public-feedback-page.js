import { insertWithOptionalColumns, number, supabase } from "./supabase.js?v=20260809-fast-project-list-v167";

const params = new URLSearchParams(window.location.search);
const projectId = params.get("project_id");
const projectCodeParam = params.get("project_code") || params.get("code") || "";
const projectServiceParam = params.get("project") || params.get("service") || params.get("title") || "";
const publicFeedbackForm = document.getElementById("publicFeedbackForm");
const clientNameField = document.getElementById("client_name");
const projectServiceField = document.getElementById("project_service");
const feedbackDateField = document.getElementById("feedback_date");
const commentsField = document.getElementById("comments");
const recommendationsField = document.getElementById("recommendations");
const submitButton = publicFeedbackForm.querySelector("button[type='submit']");

function isUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function resolveFeedbackProjectId() {
  if (isUuid(projectId)) return projectId;

  const projectCode = projectCodeParam.trim();
  if (!projectCode) return "";

  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("project_code", projectCode)
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) return "";
  return isUuid(data.id) ? data.id : "";
}

if (feedbackDateField) {
  feedbackDateField.value = new Date().toISOString().split("T")[0];
}

if (projectServiceField && projectServiceParam) {
  projectServiceField.value = projectServiceParam;
}

publicFeedbackForm.addEventListener("submit", async function(e) {
  e.preventDefault();

  const selectedRating = publicFeedbackForm.querySelector("input[name='rating']:checked");
  const ratingValue = number(selectedRating?.value);

  if (!projectId && !projectCodeParam && !projectServiceField.value.trim()) {
    alert("Missing project reference. Please scan the project feedback QR code again.");
    return;
  }

  if (ratingValue < 1 || ratingValue > 5) {
    alert("Please enter a rating from 1 to 5.");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";

  const resolvedProjectId = await resolveFeedbackProjectId();
  const feedbackRecord = {
    client_name: clientNameField.value.trim(),
    project_service: projectServiceField.value.trim(),
    project_reference: projectId || projectCodeParam || projectServiceField.value.trim(),
    project_code: projectCodeParam,
    rating: ratingValue,
    overall_satisfaction: ratingValue,
    comments: commentsField.value.trim(),
    recommendations: recommendationsField.value.trim(),
    date: feedbackDateField.value || new Date().toISOString().split("T")[0]
  };

  if (resolvedProjectId) {
    feedbackRecord.project_id = resolvedProjectId;
  }

  const { error } = await insertWithOptionalColumns("feedback", feedbackRecord, [
    "project_id",
    "project_service",
    "project_reference",
    "project_code",
    "rating",
    "overall_satisfaction",
    "recommendations",
    "date"
  ]);

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
