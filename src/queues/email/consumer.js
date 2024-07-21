import { Worker } from "bullmq";

export function mockSendEmail(payload) {
  console.log("sending email to :", payload.to);
  return new Promise((resolve) => setTimeout(resolve, 1500));
}

const emailWorker = new Worker("email-queue",
async (job) => {
  const data = job.data;
  console.log("Job Id", job.id);

  await mockSendEmail({
    from: data.from,
    to: data.to,
    subject: data.subject,
    body: data.body,
  });
},
{
  connection: {
    host: "localhost",
    port: 6379,
  },
  limiter: {
    max: 50,
    duration: 10 * 1000,
  },
});

export default emailWorker;
