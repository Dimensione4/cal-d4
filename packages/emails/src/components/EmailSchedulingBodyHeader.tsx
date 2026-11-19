import type { CSSProperties } from "react";

import { BASE_URL } from "@calcom/lib/constants";

import EmailCommonDivider from "./EmailCommonDivider";
import Row from "./Row";

export type BodyHeadType = "checkCircle" | "xCircle" | "calendarCircle" | "teamCircle";

export const getHeadImage = (headerType: BodyHeadType): string => {
  switch (headerType) {
    // D4: icone ciano con nomi nuovi (Gmail tiene in cache le immagini per URL)
    case "checkCircle":
      return `${BASE_URL}/emails/d4-checkCircle@2x.png`;
    case "xCircle":
      return `${BASE_URL}/emails/xCircle@2x.png`;
    case "calendarCircle":
      return `${BASE_URL}/emails/d4-calendarCircle@2x.png`;
    case "teamCircle":
      return `${BASE_URL}/emails/d4-teamCircle@2x.png`;
  }
};

const EmailSchedulingBodyHeader = (props: {
  headerType: BodyHeadType;
  headStyles?: CSSProperties;
  avatarUrl?: string;
}) => {
  // D4: la foto del titolare sostituisce l'icona, tranne nelle email di annullamento
  const avatar = props.headerType !== "xCircle" ? props.avatarUrl : undefined;
  const image = avatar || getHeadImage(props.headerType);
  const size = avatar ? 88 : 64;

  return (
    <>
      <EmailCommonDivider
        headStyles={{ padding: "30px 30px 0 30px", borderTop: "1px solid #E1E1E1", ...props.headStyles }}>
        <td
          align="center"
          style={{
            fontSize: "0px",
            padding: "10px 25px",
            wordBreak: "break-word",
          }}>
          <Row border="0" role="presentation" style={{ borderCollapse: "collapse", borderSpacing: "0px" }}>
            <td style={{ width: size }}>
              <img
                height={size}
                src={image}
                style={{
                  border: avatar ? "3px solid #25E4E4" : "0",
                  borderRadius: avatar ? "50%" : undefined,
                  display: "block",
                  outline: "none",
                  textDecoration: "none",
                  height: `${size}px`,
                  width: `${size}px`,
                  fontSize: "13px",
                }}
                width={size}
                alt=""
              />
            </td>
          </Row>
        </td>
      </EmailCommonDivider>
    </>
  );
};

export default EmailSchedulingBodyHeader;
