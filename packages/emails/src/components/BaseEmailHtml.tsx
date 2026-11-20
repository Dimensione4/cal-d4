/* eslint-disable @next/next/no-head-element */
import { WEBAPP_URL } from "@calcom/lib/constants";

import BaseTable from "./BaseTable";
import EmailBodyLogo from "./EmailBodyLogo";
import EmailHead from "./EmailHead";
import EmailScheduledBodyHeaderContent from "./EmailScheduledBodyHeaderContent";
import EmailSchedulingBodyDivider from "./EmailSchedulingBodyDivider";
import type { BodyHeadType } from "./EmailSchedulingBodyHeader";
import EmailSchedulingBodyHeader from "./EmailSchedulingBodyHeader";
import RawHtml from "./RawHtml";
import Row from "./Row";

const Html = (props: { children: React.ReactNode }) => (
  <>
    <RawHtml html="<!doctype html>" />
    <html>{props.children}</html>
  </>
);

// D4: foto del titolare nelle email (URL https pubblico, env runtime D4_EMAIL_AVATAR_URL)
const d4AvatarUrl = () => {
  const url = process.env.D4_EMAIL_AVATAR_URL;
  return url && /^https:\/\//.test(url) ? url : undefined;
};

// D4: fascia scura con il logo + filetto ciano (solo stili inline, compatibile con i client email)
const D4Band = () => (
  <>
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{ background: "#05070A", backgroundColor: "#05070A" }}>
      <tbody>
        <tr>
          <td align="center" style={{ padding: "28px 25px 24px 25px" }}>
            <img
              src={`${WEBAPP_URL}/emails/logo.png`}
              width="208"
              height="52"
              alt="Dimensione 4"
              style={{ display: "block", width: 208, height: 52, border: 0 }}
            />
          </td>
        </tr>
      </tbody>
    </table>
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{
        background: "#12A5A3",
        backgroundColor: "#12A5A3",
        backgroundImage: "linear-gradient(90deg,#12A5A3,#25E4E4)",
      }}>
      <tbody>
        <tr>
          <td height="3" style={{ height: 3, lineHeight: "3px", fontSize: 3 }}>
            &nbsp;
          </td>
        </tr>
      </tbody>
    </table>
  </>
);

export const BaseEmailHtml = (props: {
  children: React.ReactNode;
  callToAction?: React.ReactNode;
  subject: string;
  title?: string;
  subtitle?: React.ReactNode | string;
  headerType?: BodyHeadType;
  hideLogo?: boolean;
}) => {
  return (
    <Html>
      <EmailHead title={props.subject} />
      <body style={{ wordSpacing: "normal", backgroundColor: "#EEF3F6" }}>
        <div style={{ backgroundColor: "#EEF3F6" }}>
          <RawHtml
            html={`<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="" style="width:600px;" width="600" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->`}
          />
          <div style={{ margin: "0px auto", maxWidth: 600 }}>
            <Row align="center" border="0" style={{ width: "100%" }}>
              <td
                style={{
                  direction: "ltr",
                  fontSize: "0px",
                  padding: "0px",
                  paddingTop: "40px",
                  textAlign: "center",
                }}>
                <RawHtml
                  html={`<!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr></tr></table><![endif]-->`}
                />
              </td>
            </Row>
          </div>
          <div
            style={{
              margin: "0px auto",
              maxWidth: 600,
              borderRadius: "16px",
              border: "1px solid #D6E2E8",
              padding: 0,
              overflow: "hidden",
              backgroundColor: "#FFFFFF",
            }}>
            {!props.hideLogo && <D4Band />}
            {props.headerType && (
              <EmailSchedulingBodyHeader
                headerType={props.headerType}
                headStyles={{ border: 0 }}
                avatarUrl={d4AvatarUrl()}
              />
            )}
            {props.title && (
              <EmailScheduledBodyHeaderContent
                headStyles={{ border: 0 }}
                title={props.title}
                subtitle={props.subtitle}
              />
            )}
            {(props.headerType || props.title || props.subtitle) && (
              <EmailSchedulingBodyDivider headStyles={{ border: 0 }} />
            )}

            <RawHtml
              html={`<!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" className="" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->`}
            />
            <div
              style={{
                background: "#FFFFFF",
                backgroundColor: "#FFFFFF",
                margin: "0px auto",
                maxWidth: 600,
              }}>
              <Row
                align="center"
                border="0"
                style={{ background: "#FFFFFF", backgroundColor: "#FFFFFF", width: "100%" }}>
                <td
                  style={{
                    direction: "ltr",
                    fontSize: 0,
                    padding: 0,
                    textAlign: "center",
                  }}>
                  <RawHtml
                    html={`<!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td className="" style="vertical-align:top;width:598px;" ><![endif]-->`}
                  />
                  <div
                    className="mj-column-per-100 mj-outlook-group-fix"
                    style={{
                      fontSize: 0,
                      textAlign: "left",
                      direction: "ltr",
                      display: "inline-block",
                      verticalAlign: "top",
                      width: "100%",
                    }}>
                    <Row border="0" style={{ verticalAlign: "top" }} width="100%">
                      <td align="left" style={{ fontSize: 0, padding: "10px 25px", wordBreak: "break-word" }}>
                        <div
                          style={{
                            fontFamily: "Roboto, Helvetica, sans-serif",
                            fontSize: 16,
                            fontWeight: 500,
                            lineHeight: 1,
                            textAlign: "left",
                            color: "#101010",
                          }}>
                          {props.children}
                        </div>
                      </td>
                    </Row>
                  </div>
                  <RawHtml html="<!--[if mso | IE]></td></tr></table><![endif]-->" />
                </td>
              </Row>
            </div>
            {props.callToAction && <EmailSchedulingBodyDivider headStyles={{ border: 0 }} />}
            <RawHtml
              html={`<!--[if mso | IE]></td></tr></table><table align="center" border="0" cellpadding="0" cellspacing="0" className="" style="width:600px;" width="600" bgcolor="#FFFFFF" ><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->`}
            />

            <div
              style={{
                background: "#FFFFFF",
                backgroundColor: "#FFFFFF",
                margin: "0px auto",
                maxWidth: 600,
              }}>
              <Row
                align="center"
                border="0"
                style={{ background: "#FFFFFF", backgroundColor: "#FFFFFF", width: "100%" }}>
                <td
                  style={{
                    direction: "ltr",
                    fontSize: 0,
                    padding: 0,
                    textAlign: "center",
                  }}>
                  <RawHtml
                    html={`<!--[if mso | IE]><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td className="" style="vertical-align:top;width:598px;" ><![endif]-->`}
                  />
                  {props.callToAction && (
                    <div
                      className="mj-column-per-100 mj-outlook-group-fix"
                      style={{
                        fontSize: 0,
                        textAlign: "left",
                        direction: "ltr",
                        display: "inline-block",
                        verticalAlign: "top",
                        width: "100%",
                      }}>
                      <BaseTable border="0" style={{ verticalAlign: "top" }} width="100%">
                        <tbody>
                          <tr>
                            <td
                              align="center"
                              vertical-align="middle"
                              style={{ fontSize: 0, padding: "10px 25px", wordBreak: "break-word" }}>
                              {props.callToAction}
                            </td>
                          </tr>
                          <tr>
                            <td
                              align="left"
                              style={{ fontSize: 0, padding: "10px 25px", wordBreak: "break-word" }}>
                              <div
                                style={{
                                  fontFamily: "Roboto, Helvetica, sans-serif",
                                  fontSize: 13,
                                  lineHeight: 1,
                                  textAlign: "left",
                                  color: "#000000",
                                }}
                              />
                            </td>
                          </tr>
                        </tbody>
                      </BaseTable>
                    </div>
                  )}
                  <RawHtml html="<!--[if mso | IE]></td></tr></table><![endif]-->" />
                </td>
              </Row>
            </div>
          </div>
          {!Boolean(props.hideLogo) && <EmailBodyLogo />}
          <RawHtml html="<!--[if mso | IE]></td></tr></table><![endif]-->" />
        </div>
      </body>
    </Html>
  );
};
