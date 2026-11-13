export function getTrialBookingConversionErrors(form) {
  const errors = {};
  if (!form.trialDate?.trim()) errors.trialDate = "Please select a trial date.";
  if (!form.trialTime?.trim()) errors.trialTime = "Please select a trial time.";
  if (!form.lessonType?.trim()) errors.lessonType = "Please select a lesson type.";
  if (!form.levelId?.trim()) errors.levelId = "Please select a level.";
  if (form.prospectChoice !== "new" && !form.prospectId?.trim()) {
    errors.prospectChoice = "Please select an existing prospect or create a new prospect.";
  }
  return errors;
}
