# Omise card expiration notifier
A sample AWS lambda code to check and notify expiring cards

## Setup
1. install dependencies: 

   ```bash
   npm install
   ```

2. compress this directory: 

   ```bash
   zip -r ../card-expiration.zip *
   ```

3. Upload compressed code created in the previous step to AWS lambda

4. Make an email template using keywords: `name`, `month`, `year`, `months_til_expiration`, `card_id` save it (overwrite it) to `notification_email_template.json` and upload it to AWS.

   ```bash
   aws ses create-template --cli-input-json file://notification_email_template.json
   ```

5. Set environment variable `OMISE_SECRET_KEY` to your secret key
6. Change `Source` in `createEmailParam` and `remaining_months_threshold` in `extractExpiringCards` in `index.js` appropriately.



## Notes

- After a card is notified of it's expiration, the card ID is registered in the owners (account that the card is associated with) metadata by a key named `notified_expiration`. This key's value is an array so the newly notified card ID would be appended to this array. When updating a card you have to clear it from this array to enable monitoring for expiration again.
- AWS SES allows a maximum of 50 address to send at a time. Therefore if the number of cards to notify exceeds this number, you must change the code or run this code multiple times.
- The sample email in this repo `notification_email_template.json` might not be suitable as a notification email. You should customize it before registering it on AWS SES.