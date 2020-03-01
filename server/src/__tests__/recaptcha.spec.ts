import Redis from 'ioredis'
import umbress from '../index'
import request from 'supertest'
import { v4 as uuidv4 } from 'uuid'
import express from 'express'

const redis = new Redis({
    keyPrefix: 'umbress_'
})

const cookieRegex = /^__umb_rcptch=([0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12});\sDomain=(.+?);\sPath=\/; Expires=(.+?);\sHttpOnly;\sSameSite=Lax$/
const clearanceCookieRegex = /^__umb_rcptch_clearance=([0-9a-fA-F]{8}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{4}\-[0-9a-fA-F]{12});\sDomain=(.+?);\sPath=\/; Expires=(.+?);\sHttpOnly;\sSameSite=Lax$/

beforeAll(async done => {
    const keys = await redis.keys('umbress_recaptcha*')
    const command = ['del']

    for (const key of keys) {
        command.push(key.replace('umbress_', ''))
    }

    await redis.pipeline([command]).exec()

    done()
})

describe('normal way', function() {
    const app = express()

    app.use(express.urlencoded({ extended: true }))

    app.use(
        umbress({
            isProxyTrusted: true,
            recaptcha: {
                enabled: true,
                siteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
                secretKey: '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe',
                cookieTtl: 0.000231481
            }
        })
    )

    app.get('/', function(req, res) {
        res.send('Captcha passed!')
    })

    it('should ask user to pass a challenge', async done => {
        const resOne = await request(app)
            .get('/')
            .set('X-Forwarded-For', '123.45.67.89')
            .expect('Content-type', /html/)
            .expect(403)
            .expect(/Prove you are not a robot/)
            .expect('Set-Cookie', cookieRegex)
            .expect(/This website is currently experiencing heavy malicious traffic and spam attacks/)

        /** Coverage - hit cached key */

        await request(app)
            .get('/')
            .set('X-Forwarded-For', '123.45.67.89')
            .expect('Content-type', /html/)
            .expect(403)
            .expect(/Prove you are not a robot/)
            .expect('Set-Cookie', cookieRegex)
            .expect(/This website is currently experiencing heavy malicious traffic and spam attacks/)

        /** */

        const [initialRecaptchaCookie] = resOne.header['set-cookie']
        const action = resOne.text.match(/action="\?__umb_rcptch_cb=(.+?)"/)[1]

        const resTwo = await request(app)
            .post('/?__umb_rcptch_cb=' + action)
            .set({
                'X-Forwarded-For': '123.45.67.89',
                Cookie: initialRecaptchaCookie
            })
            .send(`g-recaptcha-response=123456789`)
            .expect(301)
            .expect('Set-Cookie', clearanceCookieRegex)

        const [clearanceRecaptchaCookie] = resTwo.header['set-cookie']

        await request(app)
            .get('/')
            .set({
                'X-Forwarded-For': '123.45.67.89',
                Cookie: [initialRecaptchaCookie, clearanceRecaptchaCookie]
            })
            .expect('Captcha passed!')
            .expect(200)

        done()
    })
})

describe('bypass way', function() {
    const app = express()

    app.use(express.urlencoded({ extended: true }))

    app.use(
        umbress({
            isProxyTrusted: true,
            recaptcha: {
                enabled: true,
                siteKey: '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI',
                secretKey: '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe',
                cookieTtl: 0.000231481
            }
        })
    )

    app.get('/', function(req, res) {
        res.send('Captcha passed!')
    })

    it('should reject random cookies', async done => {
        await request(app)
            .get('/')
            .set({
                'X-Forwarded-For': '125.45.67.89',
                Cookie: [
                    `__umb_rcptch=${uuidv4()}; Domain=.127.0.0.1; Path=/; Expires=Sat, 29 Feb 2020 15:11:06 GMT; HttpOnly; SameSite=Lax`,
                    `__umb_rcptch_clearance=${uuidv4()}; Domain=.127.0.0.1; Path=/; Expires=Sat, 29 Feb 2020 15:11:06 GMT; HttpOnly; SameSite=Lax`
                ]
            })
            .expect('Content-type', /html/)
            .expect(403)
            .expect(/Prove you are not a robot/)
            .expect('Set-Cookie', cookieRegex)
            .expect(/This website is currently experiencing heavy malicious traffic and spam attacks/)

        done()
    })

    it('should reject random clearance cookie', async done => {
        const resOne = await request(app)
            .get('/')
            .set('X-Forwarded-For', '128.45.67.89')
            .expect('Content-type', /html/)
            .expect(403)
            .expect(/Prove you are not a robot/)
            .expect('Set-Cookie', cookieRegex)
            .expect(/This website is currently experiencing heavy malicious traffic and spam attacks/)

        const [initialRecaptchaCookie] = resOne.header['set-cookie']
        const action = resOne.text.match(/action="\?__umb_rcptch_cb=(.+?)"/)[1]

        await request(app)
            .post('/?__umb_rcptch_cb=' + action)
            .set({
                'X-Forwarded-For': '128.45.67.89',
                Cookie: initialRecaptchaCookie
            })
            .send(`g-recaptcha-response=123456789`)
            .expect(301)
            .expect('Set-Cookie', clearanceCookieRegex)

        await request(app)
            .get('/')
            .set({
                'X-Forwarded-For': '128.45.67.89',
                Cookie: [
                    initialRecaptchaCookie,
                    `__umb_rcptch_clearance=${uuidv4()}; Domain=.127.0.0.1; Path=/; Expires=Sat, 29 Feb 2020 15:11:06 GMT; HttpOnly; SameSite=Lax`
                ]
            })
            .expect('Content-type', /html/)
            .expect(403)
            .expect(/Prove you are not a robot/)
            .expect('Set-Cookie', cookieRegex)
            .expect(/This website is currently experiencing heavy malicious traffic and spam attacks/)

        done()
    })
})