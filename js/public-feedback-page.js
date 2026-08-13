import { insertWithOptionalColumns, number, supabase } from "./supabase.js?v=20260813-overview-project-budget-v194";

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

async function resolveFeedbackProject() {
  if (isUuid(projectId)) {
    const { data } = await supabase
      .from("projects")
      .select("id, project_code, project_title")
      .eq("id", projectId)
      .limit(1)
      .maybeSingle();
    return data || { id: projectId, project_code: projectCodeParam, project_title: projectServiceParam };
  }

  const projectCode = projectCodeParam.trim();
  if (!projectCode) return null;

  const { data, error } = await supabase
    .from("projects")
    .select("id, project_code, project_title")
    .eq("project_code", projectCode)
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) return null;
  return data;
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

  const resolvedProject = await resolveFeedbackProject();
  const resolvedProjectId = isUuid(resolvedProject?.id) ? resolvedProject.id : "";
  const resolvedProjectTitle = resolvedProject?.project_title || projectServiceField.value.trim();
  const feedbackRecord = {
    client_name: clientNameField.value.trim(),
    project_service: resolvedProjectTitle,
    project_title: resolvedProjectTitle,
    project_reference: projectId || projectCodeParam || projectServiceField.value.trim(),
    project_code: resolvedProject?.project_code || projectCodeParam,
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
    "project_title",
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
