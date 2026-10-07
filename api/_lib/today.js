// Today's date in India, so the model never treats past dates as "future".
function todayIST(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}
module.exports = { todayIST };
