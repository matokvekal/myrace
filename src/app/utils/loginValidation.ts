export const validateForm = (values: { familyName: string; parentPhone: string; email: string ,readAndAgreeTerms:boolean}) => {
  const errors: { [key: string]: string } = {};
  if (!values.familyName) {
    errors.familyName = "Sure name is required.";
  }
  if (!values.parentPhone) {
    errors.parentPhone = "Phone number is required.";
  } else if (!/^\d{10}$/.test(values.parentPhone)) {
    errors.parentPhone = "Phone number must be 10 digits.";
  }
  if (!values.email) {
    errors.email = "Email is required.";
  } else if (!/\S+@\S+\.\S+/.test(values.email)) {
    errors.email = "Email is invalid.";
  }
  //add validation for readAndAgreeTerms as boolian here
  if(!values.readAndAgreeTerms){
    errors.readAndAgreeTerms = "Please read  the terms and conditions."
  }
  return errors;
};
