const rp = require('request-promise')
const aws = require('aws-sdk')
const _ = require('lodash')

const Config = {
  AWSRegion: process.env.SES_AWS_REGION || 'us-east-1',
  RemainingMonthsThreshold: parseInt(process.env.REMAINING_MONTHS_THRESHOLD || 2),
  OmiseSecretKey: process.env.OMISE_SECRET_KEY || '',
  OmiseCustomerApiUrl: process.env.OMISE_CUSTOMER_API_URL || 'https://api.omise.co/customers',
  SesSource: process.env.SES_SOURCE || ''
}

const ses = new aws.SES({
  region: Config.AWSRegion
})

const monthDiff = (month, year) => {
  const today = new Date()
  return (year - today.getFullYear()) * 12 + month - today.getMonth()
}

const selectUnnotifiedCards = (customer, cards) => {
  const alreadyNotified = _.get(customer, 'metadata.notified')
  if (alreadyNotified) {
    return _.filter(cards, c => !alreadyNotified.includes(c.id))
  } else {
    return cards
  }
}

const makeEmailParamsPerCard = (customerEmail, card) => {
  const templateParams = {
    card_id: card.id,
    name: card.name,
    month: card.expiration_month,
    year: card.expiration_year,
    months_til_expiration: card.months_til_expiration
  }

  return {
    Destination: { ToAddresses: [customerEmail] },
    ReplacementTemplateData: JSON.stringify(templateParams)
  }
}

const customerWithEmailParams = (customer) => {
  const unnotifiedCards = selectUnnotifiedCards(customer, customer.cards.data)
  const cardsWithExpiration = _.map(unnotifiedCards, c => _.merge(c, Object({ months_til_expiration: monthDiff(c.expiration_month, c.expiration_year) })))
  const cardsToNotify = _.filter(cardsWithExpiration, c => c.months_til_expiration <= Config.RemainingMonthsThreshold)

  return {
    emailParams: _.map(cardsToNotify, c => makeEmailParamsPerCard(customer.email, c)),
    customer_id: customer.id,
    card_ids: _.map(cardsToNotify, c => c.id),
    notified: _.get(customer, 'metadata.notified', [])
  }
}

const getCustomers = async () => {
  const getCustomersParams = {
    url: Config.OmiseCustomerApiUrl,
    auth: {
      user: Config.OmiseSecretKey,
      pass: ''
    },
    transform: function (body) {
      return _.map(JSON.parse(body).data, c => customerWithEmailParams(c))
    }
  }
  return rp(getCustomersParams)
}

const createBulkEmailParams = (destinations) => {
  return {
    Destinations: destinations,
    Source: Config.SesSource,
    Template: 'ExpiredCardNotification',
    DefaultTemplateData: '{"name":"","month":"","year":"","months_til_expiration":"","card_id":""}'
  }
}

const registerNotified = async (customerId, cardIds) => {
  const data = {
    metadata: {
      notified: cardIds
    }
  }
  const patchCustomersParams = {
    url: Config.OmiseCustomerApiUrl + '/' + customerId,
    method: 'PATCH',
    body: data,
    json: true,
    auth: {
      'user': process.env.OMISE_SECRET_KEY,
      'pass': ''
    }
  }
  return rp(patchCustomersParams)
}

const markAsNotifiedPromises = (cardStatus, customers) => {
  return _.map(customers, function (customer) {
    const notified = customer.notified
    const cardIds = _.filter(customer.card_ids, c => cardStatus[c] === true)
    const newNotified = notified.concat(cardIds)
    const customerId = customer.customer_id
    return registerNotified(customerId, newNotified)
  })
}

const main = async () => {
  const customers = await getCustomers()
  const toSend = _.filter(customers, c => c.card_ids.length > 0)
  const destinations = _.flatMap(toSend, c => c.emailParams)
  const cards = _.flatMap(toSend, c => c.card_ids)

  if (cards.length === 0) {
    return { cardStatus: [], customers: [] }
  }

  console.log('===SENDING EMAIL===')
  const bulkEmailParams = createBulkEmailParams(destinations)
  const sendPromise = ses.sendBulkTemplatedEmail(bulkEmailParams).promise()
  return sendPromise.then((data) => {
    const statuses = {}
    _.zip(cards, data.Status).forEach(function ([cardId, status]) {
      statuses[cardId] = status.Status === 'Success'
    })
    return { cardStatus: statuses, customers: toSend }
  })
}

exports.handler = async (event, context) => {
  console.log('Incoming: ', event)

  const result = await main()
    .catch(err => {
      console.log('error', err)
      return context.fail(err)
    })
  if (result.customers.length === 0) {
    return context.succeed(event)
  }
  console.log(result.cardStatus)
  console.log('===EMAIL SENT===')
  const reports = await markAsNotifiedPromises(result.cardStatus, result.customers)
  await Promise.all(reports)
  context.succeed(event)
}
