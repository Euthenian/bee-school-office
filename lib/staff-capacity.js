export function isValidLocalInterval(startTime, endTime) {
  const pattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  return pattern.test(startTime) && pattern.test(endTime) && endTime > startTime;
}
