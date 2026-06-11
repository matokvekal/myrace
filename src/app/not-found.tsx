import HeaderLogo from "@/components/headerLogo/HeaderLogo";
import { Link } from "react-router-dom";
import "./not-found.css";
import bg from "./assets/images/loginBg.png";

export default function NotFound() {
  return (
    <div
      className="container"
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: "rgba(255, 255, 255, 0.9)",
        backgroundImage: `url(${bg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        display: "flex",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
         <div className="logowrapper">
        {/* <HeaderLogo /> */}
      </div>
      <h1>404 - Page Not Found</h1>
      <p>Sorry, the page you are looking for does not exist.</p>
      <div className="link"><Link to="/">Go back to the homepage</Link></div>
     
    </div>
  );
}
