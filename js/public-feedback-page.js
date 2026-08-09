import { insertWithOptionalColumns, number } from "./supabase.js?v=20260809-editable-serials-v149";

const params = new URLSearchParams(window.location.search);
const projectId = params.get("project_id");
const submitButton = publicFeedbackForm.querySelector("button[type='submit']");

publicFeedbackForm.addEventListener("submit", async function(e) {
  e.preventDefault();

  const ratingValue = number(rating.value);

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
    client_name: client_name.value,
    rating: ratingValue,
    overall_satisfaction: ratingValue,
    comments: comments.value,
    recommendations: recommendations.value,
    date: new Date().toISOString().split("T")[0]
  }, ["rating", "overall_satisfaction", "recommendations", "date"]);

  submitButton.disabled = false;
  submitButton.textContent = "Submit Feedback";

  if (error) {
    alert("Error submitting feedback: " + error.message);
    return;
  }

  alert("Thank you! Your feedback has been submitted.");
  publicFeedbackForm.reset();
});
