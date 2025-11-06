export const formatMoney = (amount: number) => {
  return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " đ";
};

export function formatDate(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  return `${day} tháng ${month}, ${year}`;
}

export function formatDateTimeVN(timestamp: number) {
  const date = new Date(timestamp * 1000); // timestamp tính bằng giây
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  return `${day} tháng ${month}, ${year} - ${hours}:${minutes}`;
}
