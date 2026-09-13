-- DropForeignKey
ALTER TABLE "Email" DROP CONSTRAINT "Email_gmailConnectionId_fkey";

-- DropForeignKey
ALTER TABLE "GmailConnection" DROP CONSTRAINT "GmailConnection_workflowId_fkey";
