const twoDigit = (value) => String(value).padStart(2, "0");

export const formatDate = (value, { timeSeparator = ", " } = {}) => {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return [
    `${twoDigit(date.getDate())}/${twoDigit(date.getMonth() + 1)}/${date.getFullYear()}`,
    `${twoDigit(date.getHours())}:${twoDigit(date.getMinutes())}:${twoDigit(date.getSeconds())}`
  ].join(timeSeparator);
};
